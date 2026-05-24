import { expect } from "chai";
import { ethers } from "hardhat";
import { ThemisVault, ERC20Mock } from "../typechain-types";

describe("ThemisVault — daily loss cap integration", () => {
  let vault: ThemisVault;
  let usdc: ERC20Mock;
  let admin: any, allocator: any, agent: any, user: any;

  beforeEach(async () => {
    [admin, allocator, agent, user] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("ERC20Mock");
    usdc = await Mock.deploy("USD Coin", "USDC", 6) as ERC20Mock;
    const Vault = await ethers.getContractFactory("ThemisVault");
    vault = await Vault.deploy(await usdc.getAddress(), allocator.address) as ThemisVault;

    // Mint + deposit
    await usdc.mint(user.address, ethers.parseUnits("1000", 6));
    await usdc.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(user).deposit(ethers.parseUnits("100", 6));

    // Agent approves vault for settle pulls
    await usdc.connect(agent).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  it("breaching −5% daily cap sidelines the agent AND the next allocate reverts", async () => {
    // Allocate 100 → agent gets 100 USDC; vault has 0.
    await vault.connect(allocator).allocate(agent.address, ethers.parseUnits("100", 6), 1);
    expect(await usdc.balanceOf(agent.address)).to.equal(ethers.parseUnits("100", 6));

    // Agent lost $6 → returns $94 on settle. -6 / 100 deployed = -6% > -5% cap.
    await expect(
      vault.connect(allocator).settle(agent.address, -ethers.parseUnits("6", 6))
    ).to.emit(vault, "AgentSidelined");

    expect(await vault.agentSidelined(agent.address)).to.equal(true);
    expect(await vault.agentAllocation(agent.address)).to.equal(0);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(ethers.parseUnits("94", 6));

    // Subsequent allocate to the sidelined agent reverts.
    await expect(
      vault.connect(allocator).allocate(agent.address, ethers.parseUnits("10", 6), 2)
    ).to.be.revertedWith("agent sidelined");
  });

  it("losing 4% does NOT sideline (under −5% cap)", async () => {
    await vault.connect(allocator).allocate(agent.address, ethers.parseUnits("100", 6), 1);
    await vault.connect(allocator).settle(agent.address, -ethers.parseUnits("4", 6));
    expect(await vault.agentSidelined(agent.address)).to.equal(false);
    // Vault should still accept a new allocation
    await vault.connect(allocator).allocate(agent.address, ethers.parseUnits("10", 6), 2);
    expect(await vault.agentAllocation(agent.address)).to.equal(ethers.parseUnits("10", 6));
  });

  it("admin can unsideline after a sideline", async () => {
    await vault.connect(allocator).allocate(agent.address, ethers.parseUnits("100", 6), 1);
    await vault.connect(allocator).settle(agent.address, -ethers.parseUnits("6", 6));
    expect(await vault.agentSidelined(agent.address)).to.equal(true);

    await vault.connect(admin).unsidelineAgent(agent.address);
    expect(await vault.agentSidelined(agent.address)).to.equal(false);

    // After unsideline, a fresh allocation works again
    await vault.connect(allocator).allocate(agent.address, ethers.parseUnits("10", 6), 2);
    expect(await vault.agentAllocation(agent.address)).to.equal(ethers.parseUnits("10", 6));
  });
});
