import { AgentId, AgentProposal, AgentState } from "@themis/shared";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import { upsertAgentState, insertPnl, selectAgentState, selectPnlHistory, setStuckReason } from "./db.js";

const AGENT_ADDRESSES: Record<AgentId, string> = {
  hermes: process.env.AGENT_ADDRESS_HERMES ?? "",
  pythia: process.env.AGENT_ADDRESS_PYTHIA ?? "",
  demeter: process.env.AGENT_ADDRESS_DEMETER ?? "",
};

// Validate agent addresses at startup
const missingAddresses = Object.entries(AGENT_ADDRESSES)
  .filter(([, addr]) => !addr || addr === "")
  .map(([id]) => `AGENT_ADDRESS_${id.toUpperCase()}`);
if (missingAddresses.length > 0) {
  console.warn(`[allocator] Missing agent addresses: ${missingAddresses.join(", ")} — allocation will record empty addresses`);
}

function makeState(agentId: AgentId): AgentState {
  const row = selectAgentState.get(agentId) as
    | { trades_completed: number; cumulative_pnl_today: number; last_settle_day: number; stuck_reason: string | null }
    | undefined;
  const history = (selectPnlHistory.all(agentId) as Array<{ ts: number; pnl_usdc6: number }>)
    .reverse()
    .map(r => ({ timestamp: r.ts, pnl: r.pnl_usdc6 / 1_000_000 }));

  const todayDay = Math.floor(Date.now() / 86_400_000);
  const cumulativeToday = row && row.last_settle_day === todayDay ? row.cumulative_pnl_today / 1_000_000 : 0;

  return {
    agentId,
    address: AGENT_ADDRESSES[agentId],
    tradesCompleted: row?.trades_completed ?? 0,
    currentAllocationUsd: 0,
    cumulativePnlToday: cumulativeToday,
    pnlHistory: history,
    sidelined: false,
    stuckReason: row?.stuck_reason ?? null,
  };
}

const agentStates: Record<AgentId, AgentState> = {
  hermes: makeState("hermes"),
  pythia: makeState("pythia"),
  demeter: makeState("demeter"),
};

const lastSettleDayByAgent: Record<AgentId, number> = {
  hermes: selectAgentState.get("hermes") ? (selectAgentState.get("hermes") as any).last_settle_day : 0,
  pythia: selectAgentState.get("pythia") ? (selectAgentState.get("pythia") as any).last_settle_day : 0,
  demeter: selectAgentState.get("demeter") ? (selectAgentState.get("demeter") as any).last_settle_day : 0,
};

const proposals: AgentProposal[] = [];

export const state = {
  addProposal(p: AgentProposal) { proposals.push(p); },
  getRecentProposals(): AgentProposal[] { return [...proposals]; },
  clearProposals() { proposals.length = 0; },
  getAgentState(id: AgentId): AgentState { return agentStates[id]; },
  getAllAgentStates(): Record<AgentId, AgentState> { return agentStates; },

  recordAllocation(agentId: AgentId, amountUsd: number) {
    agentStates[agentId].currentAllocationUsd = amountUsd;
  },

  recordSettlement(agentId: AgentId, pnl: number) {
    const s = agentStates[agentId];
    const todayDay = Math.floor(Date.now() / 86_400_000);
    if (lastSettleDayByAgent[agentId] !== todayDay) {
      s.cumulativePnlToday = 0;
      lastSettleDayByAgent[agentId] = todayDay;
    }
    s.tradesCompleted++;
    s.cumulativePnlToday += pnl;
    const ts = Date.now();
    s.pnlHistory.push({ timestamp: ts, pnl });
    if (s.pnlHistory.length > 100) s.pnlHistory.shift();
    s.currentAllocationUsd = 0;

    const pnlUsdc6 = Math.round(pnl * 1_000_000);
    upsertAgentState.run(agentId, s.tradesCompleted, Math.round(s.cumulativePnlToday * 1_000_000), todayDay, s.stuckReason);
    insertPnl.run(agentId, ts, pnlUsdc6);
  },

  markStuck(agentId: AgentId, reason: string) {
    agentStates[agentId].stuckReason = reason;
    setStuckReason.run(agentId, reason);
  },

  clearStuck(agentId: AgentId) {
    agentStates[agentId].stuckReason = null;
    setStuckReason.run(agentId, null);
  },

  snapshot() {
    return { agentStates, pendingProposals: proposals.length };
  },

  hydrate(data: Record<AgentId, Partial<AgentState>>) {
    for (const id of Object.keys(data) as AgentId[]) {
      Object.assign(agentStates[id], data[id]);
    }
  },
};
