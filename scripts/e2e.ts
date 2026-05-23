/**
 * E2E smoke test: simulate one full cycle without real LLM/IPFS calls.
 * Run after contracts are deployed and .env is populated.
 * Usage: tsx scripts/e2e.ts
 */
import { AgentProposal } from "@themis/shared";
import * as dotenv from "dotenv";
dotenv.config();

const ALLOCATOR = process.env.ALLOCATOR_URL ?? "http://localhost:3001";
const INDEXER   = process.env.INDEXER_URL   ?? "http://localhost:3002";

const mockProposals: AgentProposal[] = [
  {
    agentId: "hermes", tradeIdea: "Long BTC-PERP funding arb 2x",
    action: "long", venue: "hyperliquid", requestedSizeUsd: 400,
    confidence: 0.82, reasoningTraceCid: "hash://test-hermes",
    reasoningHash: "0xabc", timestamp: Math.floor(Date.now() / 1000),
  },
  {
    agentId: "pythia", tradeIdea: "Short ETH on negative sentiment",
    action: "short", venue: "hyperliquid", requestedSizeUsd: 300,
    confidence: 0.65, reasoningTraceCid: "hash://test-pythia",
    reasoningHash: "0xdef", timestamp: Math.floor(Date.now() / 1000),
  },
  {
    agentId: "demeter", tradeIdea: "Rotate 200 USDC to USYC at 5.2% APY",
    action: "rotate", venue: "usyc", requestedSizeUsd: 200,
    confidence: 0.95, reasoningTraceCid: "hash://test-demeter",
    reasoningHash: "0x123", timestamp: Math.floor(Date.now() / 1000),
  },
];

async function main() {
  console.log("=== Themis E2E smoke test ===\n");

  // 1. Check allocator is up
  const stateResp = await fetch(`${ALLOCATOR}/state`);
  const stateData = await stateResp.json();
  console.log("✓ Allocator /state:", JSON.stringify(stateData).slice(0, 80));

  // 2. Submit mock proposals
  for (const p of mockProposals) {
    await fetch(`${ALLOCATOR}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(p),
    });
    console.log(`✓ Submitted proposal from ${p.agentId}`);
  }

  // 3. Wait for allocation cycle (allocator fires 5s after agents, cycle is 60s)
  console.log("\nWaiting 70s for allocation cycle...");
  await new Promise(r => setTimeout(r, 70_000));

  // 4. Check indexer state
  const tvlResp = await fetch(`${INDEXER}/tvl`);
  const tvlData = await tvlResp.json();
  console.log("✓ Indexer /tvl:", tvlData);

  const tracesResp = await fetch(`${INDEXER}/traces`);
  const tracesData = await tracesResp.json();
  console.log(`✓ Indexer /traces: ${tracesData.length} records`);

  console.log("\n=== E2E complete ===");
}

main().catch(err => { console.error(err); process.exit(1); });
