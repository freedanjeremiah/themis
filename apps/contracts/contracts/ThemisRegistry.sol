// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ThemisRegistry {
    address public admin;
    address public allocator;

    struct AgentStats {
        uint64  tradesWon;
        uint64  tradesLost;
        int128  cumulativePnlUsdc;
        bool    active;
    }
    mapping(address => AgentStats) public stats;

    event AgentRegistered(address indexed agent);
    event OutcomeRecorded(address indexed agent, bool won, int128 pnl);

    modifier onlyAdmin() { require(msg.sender == admin, "not admin"); _; }
    modifier onlyAllocator() { require(msg.sender == allocator, "not allocator"); _; }

    constructor(address _allocator) {
        admin = msg.sender;
        allocator = _allocator;
    }

    function registerAgent(address agent) external onlyAdmin {
        stats[agent].active = true;
        emit AgentRegistered(agent);
    }

    function recordOutcome(address agent, bool won, int128 pnl) external onlyAllocator {
        if (won) stats[agent].tradesWon++; else stats[agent].tradesLost++;
        stats[agent].cumulativePnlUsdc += pnl;
        emit OutcomeRecorded(agent, won, pnl);
    }
}
