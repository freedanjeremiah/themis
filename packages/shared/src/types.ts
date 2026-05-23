export type AgentId = "hermes" | "pythia" | "demeter";

export type AgentProposal = {
  agentId: AgentId;
  tradeIdea: string;
  action: "long" | "short" | "rotate" | "hold";
  venue: "hyperliquid" | "arc-dex" | "usyc" | "aave";
  requestedSizeUsd: number;
  confidence: number;
  reasoningTraceCid: string;
  reasoningHash: string;
  timestamp: number;
};

export type AllocationResult = {
  cycleId: number;
  winners: { agentId: AgentId; allocatedUsd: number }[];
  losers:  { agentId: AgentId; allocatedUsd: number }[];
  timestamp: number;
};

export type TraceRecord = {
  id: number;
  agentId: AgentId;
  cid: string;
  hash: string;
  tradeIdea: string;
  confidence: number;
  blockTime: number;
};

export type AgentState = {
  agentId: AgentId;
  address: string;
  tradesCompleted: number;
  currentAllocationUsd: number;
  cumulativePnlToday: number;
  pnlHistory: { timestamp: number; pnl: number }[];
  sidelined: boolean;
};

export type WsMessage = {
  event: "allocation" | "trace" | "deposit" | "settlement";
  data: unknown;
};
