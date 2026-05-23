import { AgentId, AgentProposal, AgentState } from "@themis/shared";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

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
  return {
    agentId,
    address: AGENT_ADDRESSES[agentId],
    tradesCompleted: 0,
    currentAllocationUsd: 0,
    cumulativePnlToday: 0,
    pnlHistory: [],
    sidelined: false,
  };
}

const agentStates: Record<AgentId, AgentState> = {
  hermes: makeState("hermes"),
  pythia: makeState("pythia"),
  demeter: makeState("demeter"),
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
    s.tradesCompleted++;
    s.cumulativePnlToday += pnl;
    s.pnlHistory.push({ timestamp: Date.now(), pnl });
    if (s.pnlHistory.length > 100) s.pnlHistory.shift();
    s.currentAllocationUsd = 0;
  },

  sidelineAgent(agentId: AgentId) {
    agentStates[agentId].sidelined = true;
    agentStates[agentId].currentAllocationUsd = 0;
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
