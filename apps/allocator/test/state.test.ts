import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("allocator state persistence", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "themis-alloc-"));
    process.env.ALLOCATOR_DB_PATH = join(tmp, "state.db");
    process.env.AGENT_ADDRESS_HERMES = "0x0000000000000000000000000000000000000001";
    process.env.AGENT_ADDRESS_PYTHIA = "0x0000000000000000000000000000000000000002";
    process.env.AGENT_ADDRESS_DEMETER = "0x0000000000000000000000000000000000000003";
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("persists settlements and cumulative PnL across re-imports of state.ts", async () => {
    // First import: record a settlement.
    const mod1 = await import("../src/state.js");
    mod1.state.recordSettlement("hermes", 1.5);
    mod1.state.recordSettlement("hermes", -0.5);

    // Second import: hydrates from disk.
    vi.resetModules();
    const mod2 = await import("../src/state.js");
    const s = mod2.state.getAgentState("hermes");
    expect(s.tradesCompleted).toBe(2);
    expect(s.pnlHistory.length).toBe(2);
    // pnlHistory order: oldest to newest after reverse
    expect(s.pnlHistory[0].pnl).toBe(1.5);
    expect(s.pnlHistory[1].pnl).toBe(-0.5);
    expect(s.cumulativePnlToday).toBeCloseTo(1.0); // 1.5 + (-0.5) = 1.0
  });
});

describe("allocator stuck-agent tracking", () => {
  let tmp2: string;

  beforeEach(() => {
    tmp2 = mkdtempSync(join(tmpdir(), "themis-stuck-"));
    process.env.ALLOCATOR_DB_PATH = join(tmp2, "state.db");
    process.env.AGENT_ADDRESS_HERMES = "0x0000000000000000000000000000000000000001";
    process.env.AGENT_ADDRESS_PYTHIA = "0x0000000000000000000000000000000000000002";
    process.env.AGENT_ADDRESS_DEMETER = "0x0000000000000000000000000000000000000003";
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmp2, { recursive: true, force: true });
  });

  it("markStuck sets reason and clearStuck removes it; persists across re-import", async () => {
    const mod1 = await import("../src/state.js");
    mod1.state.markStuck("hermes", "cctp_attestation_timeout");
    expect(mod1.state.getAgentState("hermes").stuckReason).toBe("cctp_attestation_timeout");

    vi.resetModules();
    const mod2 = await import("../src/state.js");
    expect(mod2.state.getAgentState("hermes").stuckReason).toBe("cctp_attestation_timeout");

    mod2.state.clearStuck("hermes");
    expect(mod2.state.getAgentState("hermes").stuckReason).toBeNull();

    vi.resetModules();
    const mod3 = await import("../src/state.js");
    expect(mod3.state.getAgentState("hermes").stuckReason).toBeNull();
  });
});
