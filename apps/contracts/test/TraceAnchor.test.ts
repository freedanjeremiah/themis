import { expect } from "chai";
import { ethers } from "hardhat";

describe("TraceAnchor", () => {
  it("emits TraceAnchored event with correct agent and hash", async () => {
    const [agent] = await ethers.getSigners();
    const Anchor = await ethers.getContractFactory("TraceAnchor");
    const anchor = await Anchor.deploy();

    const hash = ethers.keccak256(ethers.toUtf8Bytes("test-trace"));
    const cid = "ipfs://QmTest123";

    const tx = await anchor.anchor(agent.address, hash, cid);
    const receipt = await tx.wait();

    // Check event was emitted via filter
    const filter = anchor.filters.TraceAnchored(agent.address);
    const events = await anchor.queryFilter(filter, receipt!.blockNumber, receipt!.blockNumber);
    expect(events).to.have.length(1);
    expect(events[0].args.agent).to.equal(agent.address);
    expect(events[0].args.hash).to.equal(hash);
    expect(events[0].args.cid).to.equal(cid);
    expect(events[0].args.timestamp).to.be.greaterThan(0);
  });
});
