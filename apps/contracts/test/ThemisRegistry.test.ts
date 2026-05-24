import { expect } from "chai";
import { ethers } from "hardhat";

describe("ThemisRegistry", () => {
  it("defaults agents to inactive", async () => {
    const [admin, allocator, agent] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    const [, , , active] = await registry.stats(agent.address);
    expect(active).to.equal(false);
  });

  it("registerAgent flips active to true", async () => {
    const [admin, allocator, agent] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    await expect(registry.connect(admin).registerAgent(agent.address))
      .to.emit(registry, "AgentRegistered").withArgs(agent.address);
    const [, , , active] = await registry.stats(agent.address);
    expect(active).to.equal(true);
  });

  it("registerAgent reverts when caller is not admin", async () => {
    const [admin, allocator, agent, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    await expect(
      registry.connect(stranger).registerAgent(agent.address)
    ).to.be.revertedWith("not admin");
  });

  it("recordOutcome increments wins and cumulative PnL", async () => {
    const [admin, allocator, agent] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    await registry.connect(admin).registerAgent(agent.address);

    await registry.connect(allocator).recordOutcome(agent.address, true, 100);
    await registry.connect(allocator).recordOutcome(agent.address, false, -30);

    const [won, lost, pnl] = await registry.stats(agent.address);
    expect(won).to.equal(1n);
    expect(lost).to.equal(1n);
    expect(pnl).to.equal(70n);
  });

  it("recordOutcome reverts when caller is not allocator", async () => {
    const [admin, allocator, agent, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    await registry.connect(admin).registerAgent(agent.address);
    await expect(
      registry.connect(stranger).recordOutcome(agent.address, true, 10)
    ).to.be.revertedWith("not allocator");
  });
});
