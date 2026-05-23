import { AgentState, AgentProposal } from "@themis/shared";

const YIELD_VENUES: AgentProposal["venue"][] = ["usyc", "aave"];

export function score(agent: AgentState, proposal: AgentProposal): number {
  const diversificationBonus = YIELD_VENUES.includes(proposal.venue) ? 0.1 : 0;

  if (agent.tradesCompleted < 10) {
    return 0.6 * proposal.confidence + 0.4 * diversificationBonus;
  }

  const sharpe = Math.min(computeRollingSharpe(agent.pnlHistory), 2);
  return 0.5 * sharpe + 0.3 * proposal.confidence + 0.2 * diversificationBonus;
}

export function computeRollingSharpe(history: { timestamp: number; pnl: number }[]): number {
  if (history.length < 2) return 0;
  const returns = history.map(h => h.pnl);
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return mean > 0 ? 1 : 0;
  return mean / stdDev;
}
