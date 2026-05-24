import { describe, it, expect } from "vitest";
import { score, computeRollingSharpe } from "../src/scorer.js";
import { AgentState, AgentProposal } from "@themis/shared";

const baseState: AgentState = {
  agentId: "hermes",
  address: "0x1",
  tradesCompleted: 0,
  currentAllocationUsd: 0,
  cumulativePnlToday: 0,
  pnlHistory: [],
  sidelined: false,
  stuckReason: null,
};

const baseProposal: AgentProposal = {
  agentId: "hermes",
  tradeIdea: "long BTC",
  action: "long",
  venue: "hyperliquid",
  requestedSizeUsd: 500,
  confidence: 0.8,
  reasoningTraceCid: "ipfs://test",
  reasoningHash: "0xabc",
  timestamp: Math.floor(Date.now() / 1000),
};

describe("score (bootstrap phase, <10 trades)", () => {
  it("uses confidence-heavy formula", () => {
    const s = score(baseState, baseProposal);
    // 0.6 * 0.8 + 0.4 * 0 = 0.48
    expect(s).toBeCloseTo(0.48);
  });

  it("adds diversification bonus for yield venues", () => {
    const s = score(baseState, { ...baseProposal, venue: "usyc" });
    // 0.6 * 0.8 + 0.4 * 0.1 = 0.52
    expect(s).toBeCloseTo(0.52);
  });
});

describe("score (post-bootstrap, >=10 trades)", () => {
  it("uses Sharpe-heavy formula with positive history", () => {
    const state: AgentState = {
      ...baseState,
      tradesCompleted: 10,
      pnlHistory: Array.from({ length: 10 }, (_, i) => ({ timestamp: i, pnl: 5 })),
    };
    const s = score(state, baseProposal);
    // With constant returns, Sharpe = 1 (clamped), confidence = 0.8
    // 0.5 * 1 + 0.3 * 0.8 + 0.2 * 0 = 0.74
    expect(s).toBeGreaterThan(0.5);
  });
});

describe("computeRollingSharpe", () => {
  it("returns 0 for empty history", () => {
    expect(computeRollingSharpe([])).toBe(0);
  });

  it("returns 0 for single data point", () => {
    expect(computeRollingSharpe([{ timestamp: 0, pnl: 10 }])).toBe(0);
  });

  it("computes sharpe correctly for varied returns", () => {
    const history = [
      { timestamp: 0, pnl: 10 },
      { timestamp: 1, pnl: 20 },
      { timestamp: 2, pnl: 15 },
    ];
    const s = computeRollingSharpe(history);
    expect(s).toBeGreaterThan(0);
  });

  it("returns 1 for constant positive returns (zero stddev)", () => {
    const history = [
      { timestamp: 0, pnl: 5 },
      { timestamp: 1, pnl: 5 },
      { timestamp: 2, pnl: 5 },
    ];
    expect(computeRollingSharpe(history)).toBe(1);
  });
});
