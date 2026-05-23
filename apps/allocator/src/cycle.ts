import { state } from "./state.js";
import { score } from "./scorer.js";
import { vaultAllocate, vaultSettle, registryRecord, getTotalAssetsUsdc } from "./vault.js";
import { AgentId } from "@themis/shared";

const K = 2;
let cycleId = 0;

export async function runCycle(): Promise<void> {
  cycleId++;
  const now = Date.now() / 1000;

  const allProposals = state.getRecentProposals();
  const proposals = allProposals.filter(p => {
    if (typeof p.timestamp !== "number" || now - p.timestamp > 90) {
      console.warn(`[allocator] dropped stale/invalid proposal from ${p.agentId}`);
      return false;
    }
    return true;
  });

  if (proposals.length === 0) {
    state.clearProposals();
    return;
  }

  const totalUsd = await getTotalAssetsUsdc();
  const maxDeploy = totalUsd * 0.8;

  const agentStates = state.getAllAgentStates();
  const scored = proposals
    .filter(p => !agentStates[p.agentId].sidelined)
    .map(p => ({ proposal: p, s: score(agentStates[p.agentId], p) }))
    .sort((a, b) => b.s - a.s);

  const winners = scored.slice(0, K);
  const losers = scored.slice(K);

  const totalRequested = winners.reduce((sum, w) => sum + w.proposal.requestedSizeUsd, 0);
  const scaleFactor = totalRequested > maxDeploy ? maxDeploy / totalRequested : 1;

  for (const { proposal } of winners) {
    const amount = BigInt(Math.floor(proposal.requestedSizeUsd * scaleFactor * 1e6));
    try {
      await vaultAllocate(proposal.agentId, amount, cycleId);
      state.recordAllocation(proposal.agentId, Number(amount) / 1e6);
      console.log(`[allocator] allocated ${Number(amount) / 1e6} USDC to ${proposal.agentId}`);
    } catch (err) {
      console.error(`[allocator] allocate failed for ${proposal.agentId}:`, err);
    }
  }

  for (const { proposal } of losers) {
    const amount = BigInt(Math.floor(proposal.requestedSizeUsd * 0.01 * 1e6));
    try {
      await vaultAllocate(proposal.agentId, amount, cycleId);
    } catch { /* consolation failures are non-fatal */ }
  }

  state.clearProposals();
}

export async function recordSettlement(agentId: AgentId, pnlUsd: number): Promise<void> {
  const pnlUsdc6 = BigInt(Math.round(pnlUsd * 1e6));
  await vaultSettle(agentId, pnlUsdc6);
  await registryRecord(agentId, pnlUsd >= 0, pnlUsdc6);
  state.recordSettlement(agentId, pnlUsd);
}
