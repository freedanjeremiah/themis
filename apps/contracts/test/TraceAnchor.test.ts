import { expect } from "chai";
import { ethers } from "hardhat";

describe("TraceAnchor", () => {
  it("emits TraceAnchored when caller is a registered agent", async () => {
    const [admin, allocator, agent] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    await registry.connect(admin).registerAgent(agent.address);

    const Anchor = await ethers.getContractFactory("TraceAnchor");
    const anchor = await Anchor.deploy(await registry.getAddress());

    const hash = ethers.keccak256(ethers.toUtf8Bytes("test-trace"));
    const cid = "ipfs://QmTest123";

    const tx = await anchor.connect(agent).anchor(hash, cid);
    const receipt = await tx.wait();

    const filter = anchor.filters.TraceAnchored(agent.address);
    const events = await anchor.queryFilter(filter, receipt!.blockNumber, receipt!.blockNumber);
    expect(events).to.have.length(1);
    expect(events[0].args.agent).to.equal(agent.address);
    expect(events[0].args.hash).to.equal(hash);
    expect(events[0].args.cid).to.equal(cid);
    expect(events[0].args.timestamp).to.be.greaterThan(0);
  });

  it("reverts when caller is not a registered agent", async () => {
    const [admin, allocator, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    const Anchor = await ethers.getContractFactory("TraceAnchor");
    const anchor = await Anchor.deploy(await registry.getAddress());

    const hash = ethers.keccak256(ethers.toUtf8Bytes("trace"));
    await expect(
      anchor.connect(stranger).anchor(hash, "ipfs://Qm")
    ).to.be.revertedWith("not registered agent");
  });
});
