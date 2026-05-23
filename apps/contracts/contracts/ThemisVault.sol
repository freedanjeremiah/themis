// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract ThemisVault {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public allocator;
    address public admin;

    uint256 public constant WALLET_CAP    = 100e6;
    uint256 public constant VAULT_CAP     = 5_000e6;
    uint256 public constant LOSS_CAP_BPS  = 500;
    uint256 public constant BPS_DENOM     = 10_000;

    uint256 public totalAssets;
    uint256 public totalShares;
    uint256 public totalDeployed;
    bool    public paused;

    mapping(address => uint256) public shareBalances;
    mapping(address => uint256) public depositedBy;
    mapping(address => uint256) public agentAllocation;
    mapping(address => bool)    public agentSidelined;
    mapping(address => int256)  public agentDailyPnl;
    mapping(address => uint256) public agentDayStart;
    mapping(address => uint256) public agentDailyDeployed;

    event Deposited(address indexed wallet, uint256 amount, uint256 shares);
    event Withdrawn(address indexed wallet, uint256 shares, uint256 amount);
    event Allocated(address indexed agent, uint256 amount, uint256 cycleId);
    event Settled(address indexed agent, int256 pnl, uint256 newTotalAssets);
    event AgentSidelined(address indexed agent, int256 dailyPnl);

    error Paused();
    error InsufficientLiquidity(uint256 available, uint256 requested);
    error NotAllocator();
    error NotAdmin();

    modifier notPaused() { if (paused) revert Paused(); _; }
    modifier onlyAllocator() { if (msg.sender != allocator) revert NotAllocator(); _; }
    modifier onlyAdmin() { if (msg.sender != admin) revert NotAdmin(); _; }

    constructor(address _usdc, address _allocator) {
        usdc = IERC20(_usdc);
        allocator = _allocator;
        admin = msg.sender;
    }

    function deposit(uint256 amount) external notPaused {
        require(amount > 0, "zero amount");
        require(depositedBy[msg.sender] + amount <= WALLET_CAP, "wallet cap exceeded");
        require(totalAssets + amount <= VAULT_CAP, "vault cap exceeded");

        uint256 shares = totalShares == 0
            ? amount
            : (amount * totalShares) / totalAssets;

        depositedBy[msg.sender] += amount;
        shareBalances[msg.sender] += shares;
        totalShares += shares;
        totalAssets += amount;

        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount, shares);
    }

    function withdraw(uint256 shares) external notPaused {
        require(shares > 0 && shareBalances[msg.sender] >= shares, "invalid shares");
        uint256 amount = (shares * totalAssets) / totalShares;
        uint256 liquid = liquidReserve();
        if (amount > liquid) revert InsufficientLiquidity(liquid, amount);

        shareBalances[msg.sender] -= shares;
        totalShares -= shares;
        totalAssets -= amount;

        usdc.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, shares, amount);
    }

    function allocate(address agent, uint256 amount, uint256 cycleId) external onlyAllocator notPaused {
        require(!agentSidelined[agent], "agent sidelined");
        totalDeployed = totalDeployed - agentAllocation[agent] + amount;
        agentAllocation[agent] = amount;
        _resetDailyIfNeeded(agent);
        agentDailyDeployed[agent] += amount;
        emit Allocated(agent, amount, cycleId);
    }

    function settle(address agent, int256 pnl) external onlyAllocator {
        _resetDailyIfNeeded(agent);
        agentDailyPnl[agent] += pnl;

        if (pnl >= 0) {
            totalAssets += uint256(pnl);
        } else {
            uint256 loss = uint256(-pnl);
            totalAssets = totalAssets > loss ? totalAssets - loss : 0;
        }

        totalDeployed = totalDeployed > agentAllocation[agent]
            ? totalDeployed - agentAllocation[agent] : 0;
        agentAllocation[agent] = 0;

        uint256 basis = agentDailyDeployed[agent];
        if (basis > 0) {
            int256 cap = -int256((basis * LOSS_CAP_BPS) / BPS_DENOM);
            if (agentDailyPnl[agent] < cap) {
                agentSidelined[agent] = true;
                emit AgentSidelined(agent, agentDailyPnl[agent]);
            }
        }

        emit Settled(agent, pnl, totalAssets);
    }

    function sidelineAgent(address agent) external onlyAllocator {
        agentSidelined[agent] = true;
        totalDeployed = totalDeployed > agentAllocation[agent]
            ? totalDeployed - agentAllocation[agent] : 0;
        agentAllocation[agent] = 0;
        emit AgentSidelined(agent, agentDailyPnl[agent]);
    }

    function unsidelineAgent(address agent) external onlyAdmin {
        agentSidelined[agent] = false;
    }

    function setAllocator(address _allocator) external onlyAdmin { allocator = _allocator; }
    function pause() external onlyAdmin { paused = true; }
    function unpause() external onlyAdmin { paused = false; }

    function liquidReserve() public view returns (uint256) {
        return totalAssets > totalDeployed ? totalAssets - totalDeployed : 0;
    }

    function sharePrice() public view returns (uint256) {
        if (totalShares == 0) return 1e6;
        return (totalAssets * 1e6) / totalShares;
    }

    function _resetDailyIfNeeded(address agent) internal {
        uint256 today = (block.timestamp / 86400) * 86400;
        if (agentDayStart[agent] < today) {
            agentDayStart[agent] = today;
            agentDailyPnl[agent] = 0;
            agentDailyDeployed[agent] = 0;
        }
    }
}
