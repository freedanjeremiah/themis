import { expect } from "chai";
import { ethers } from "hardhat";
import { ThemisVault, ERC20Mock } from "../typechain-types";

describe("ThemisVault", () => {
  let vault: ThemisVault;
  let usdc: ERC20Mock;
  let admin: any, allocator: any, user1: any, user2: any;

  beforeEach(async () => {
    [admin, allocator, user1, user2] = await ethers.getSigners();
    const MockERC20 = await ethers.getContractFactory("ERC20Mock");
    usdc = await MockERC20.deploy("USD Coin", "USDC", 6) as ERC20Mock;
    const Vault = await ethers.getContractFactory("ThemisVault");
    vault = await Vault.deploy(await usdc.getAddress(), allocator.address) as ThemisVault;
    await usdc.mint(user1.address, ethers.parseUnits("1000", 6));
    await usdc.mint(user2.address, ethers.parseUnits("1000", 6));
    await usdc.connect(user1).approve(await vault.getAddress(), ethers.MaxUint256);
    await usdc.connect(user2).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  it("mints shares on deposit", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    expect(await vault.shareBalances(user1.address)).to.equal(ethers.parseUnits("100", 6));
    expect(await vault.totalAssets()).to.equal(ethers.parseUnits("100", 6));
  });

  it("reverts when wallet cap exceeded", async () => {
    await expect(
      vault.connect(user1).deposit(ethers.parseUnits("101", 6))
    ).to.be.revertedWith("wallet cap exceeded");
  });

  it("returns USDC on withdraw from liquid reserve", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    const shares = await vault.shareBalances(user1.address);
    const balanceBefore = await usdc.balanceOf(user1.address);
    await vault.connect(user1).withdraw(shares);
    expect(await usdc.balanceOf(user1.address)).to.equal(balanceBefore + ethers.parseUnits("100", 6));
  });

  it("reverts withdraw when insufficient liquidity", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    // Deploy 90% of assets — leaves only 10% liquid, so full withdrawal should fail
    await vault.connect(allocator).allocate(
      allocator.address, ethers.parseUnits("90", 6), 1
    );
    const shares = await vault.shareBalances(user1.address);
    await expect(vault.connect(user1).withdraw(shares))
      .to.be.revertedWithCustomError(vault, "InsufficientLiquidity");
  });

  it("pulls USDC back on settle with positive PnL", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("50", 6), 1);
    // Agent (allocator EOA here) made $5: now holds 55, vault holds 50.
    await usdc.mint(allocator.address, ethers.parseUnits("5", 6));
    await usdc.connect(allocator).approve(await vault.getAddress(), ethers.MaxUint256);

    await vault.connect(allocator).settle(allocator.address, ethers.parseUnits("5", 6));

    expect(await vault.totalAssets()).to.equal(ethers.parseUnits("105", 6));
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(ethers.parseUnits("105", 6));
    expect(await vault.agentAllocation(allocator.address)).to.equal(0);
  });

  it("pulls USDC back on settle with negative PnL and sidelines on >5% loss", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("100", 6), 1);
    // Agent lost 6: now holds 94, vault holds 0.
    await usdc.connect(allocator).approve(await vault.getAddress(), ethers.MaxUint256);

    await expect(
      vault.connect(allocator).settle(allocator.address, -ethers.parseUnits("6", 6))
    ).to.emit(vault, "AgentSidelined");

    expect(await vault.totalAssets()).to.equal(ethers.parseUnits("94", 6));
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(ethers.parseUnits("94", 6));
    expect(await vault.agentSidelined(allocator.address)).to.equal(true);
  });

  it("settle with zero PnL still clears allocation without moving funds", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("30", 6), 1);
    await usdc.connect(allocator).approve(await vault.getAddress(), ethers.MaxUint256);

    await vault.connect(allocator).settle(allocator.address, 0);

    expect(await vault.totalAssets()).to.equal(ethers.parseUnits("100", 6));
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(ethers.parseUnits("100", 6));
    expect(await vault.agentAllocation(allocator.address)).to.equal(0);
  });

  it("pauses all state-changing functions", async () => {
    await vault.connect(admin).pause();
    await expect(vault.connect(user1).deposit(ethers.parseUnits("10", 6)))
      .to.be.revertedWithCustomError(vault, "Paused");
  });

  it("transfers USDC out to agent on allocate", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    const before = await usdc.balanceOf(allocator.address);
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("40", 6), 1);
    const after = await usdc.balanceOf(allocator.address);
    expect(after - before).to.equal(ethers.parseUnits("40", 6));
  });

  it("reverts allocate when amount exceeds liquid reserve", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    // First allocate 80 — leaves 20 liquid.
    await vault.connect(allocator).allocate(user2.address, ethers.parseUnits("80", 6), 1);
    // Second allocate of 30 to a different agent exceeds the 20 remaining.
    await expect(
      vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("30", 6), 2)
    ).to.be.revertedWithCustomError(vault, "InsufficientLiquidity");
  });

  it("allocate reverts when paused", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(admin).pause();
    await expect(
      vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("10", 6), 1)
    ).to.be.revertedWithCustomError(vault, "Paused");
  });

  it("settle reverts when paused", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("10", 6), 1);
    await usdc.connect(allocator).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(admin).pause();
    await expect(
      vault.connect(allocator).settle(allocator.address, 0)
    ).to.be.revertedWithCustomError(vault, "Paused");
  });

  it("forceSettle works while paused (admin only)", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("40", 6), 1);
    await usdc.connect(allocator).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(admin).pause();

    await vault.connect(admin).forceSettle(allocator.address, 0);

    expect(await vault.agentAllocation(allocator.address)).to.equal(0);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(ethers.parseUnits("100", 6));
  });

  it("forceSettle reverts when called by non-admin", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("10", 6), 1);
    await usdc.connect(allocator).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(admin).pause();
    await expect(
      vault.connect(allocator).forceSettle(allocator.address, 0)
    ).to.be.revertedWithCustomError(vault, "NotAdmin");
  });
});
