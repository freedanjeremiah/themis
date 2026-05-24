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
