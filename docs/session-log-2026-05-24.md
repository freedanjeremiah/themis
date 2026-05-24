# Themis Soak Test Session Log — 2026-05-24

Hackathon deadline: **2026-05-25**. This document captures everything that happened during the debugging and soak-test session to get Themis running end-to-end with `ENABLE_REAL_TRADES=true` on Arc testnet.

---

## Starting State

Phase 2 had just been merged (real PnL, shared hl-client, CCTP bridging). The system would not run cleanly:

- Agents submitted proposals but got stuck immediately on nearly every code path
- Vault accounting was over-allocated (stale `agentAllocation` entries from interrupted cycles)
- No successful settlements had been recorded

---

## What Was Tried and Fixed

### 1. CCTP V2 Signature Mismatch

**Problem:** `depositForBurn` reverted on the Arc testnet TokenMessenger (`0x8FE6B999...`) with `CALL_EXCEPTION` and no revert data.

**Root cause:** The call used the CCTP V1 5-parameter signature. Arc testnet runs CCTP V2, which requires 7 parameters including `hookData`.

**Fix:** Updated `depositForBurn` call to the 7-param V2 signature in the bridge scripts.

**Status:** Fixed in commit `0168e36`.

---

### 2. CCTP: Chose Pre-Fund HL Approach

**Decision:** Instead of implementing and verifying the full Arc→HL→Arc CCTP roundtrip under deadline pressure, the team chose the **pre-fund approach**:

- Each agent wallet (`hermes`, `pythia`, `demeter`) has USDC pre-loaded on HyperEVM testnet (chain 998).
- Agents skip the CCTP `depositForBurn` step entirely.
- Arc-side vault allocations still track economics correctly.
- After holding a position (simulated or real HL perp), agents settle PnL back to the vault on Arc.

**Committed as:** `feat(agents): skip CCTP bridge, use pre-funded HL testnet wallets` (`03f467a`)

---

### 3. HL Order Fill — No HL L1 Margin

**Problem:** Hermes and Pythia were placing IOC orders on HL testnet exchange but getting unfilled/rejected. The stuck reason was `execute:hl_order_unfilled`.

**Root cause:** HL perp trading requires USDC deposited into the **HL L1 margin account**, separate from the HyperEVM wallet balance. All three agent wallets had USDC on HyperEVM (chain 998) but their HL L1 accounts showed `accountValue: "0.0"`.

**Fix:** Added a simulated fill fallback in `packages/hl-client/src/client.ts`:
- `placeHlOrder()` — when IOC order doesn't fill, logs `SIMULATED fill at mark price` and returns the current mark price as fill price.
- `closeHlPosition()` — when close order doesn't fill, uses mark price as simulated exit.

This means PnL = real mark-price movement over the hold window, just without real margin.

**File:** `packages/hl-client/src/client.ts`

---

### 4. USYC Teller Revert — usyc_sim Fallback

**Problem:** Demeter was crashing with `unhandled: execution reverted (unknown custom error)` (selector `0x7f63bd0...`). The USYC Teller at `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A` rejects `deposit()` during `estimateGas`.

**Root cause:** Unknown precondition in the USYC Teller contract (possibly KYC or whitelist gated on testnet). The contract reverts with a custom error that is not in the public ABI.

**Fix:** Wrapped the Teller deposit in a try-catch in `apps/agent-demeter/src/execute.ts`:
- On success: records real shares and redeems at maturity.
- On failure: returns `venue: "usyc_sim"` with `sharesHeld = amountUsdc6`.
- `redeemFromVenue` for `"usyc_sim"` computes: `yield = depositedUsd6 × 0.052 × holdSeconds / (365×24×3600)`.

**File:** `apps/agent-demeter/src/execute.ts`

---

### 5. reportSettlement(0) → 500 Errors

**Problem:** Pythia and demeter called `reportSettlement(agentId, 0)` on paths where they were not allocated (skipped cycles, `real_trades_disabled`). This hit `vault.settle(agent, 0)` when `agentAllocation[agent] = 0`, which reverts. The allocator returned HTTP 500, causing the agent to log an error and the allocator to set a stuck flag.

**Root cause:** `ThemisVault.settle()` calls `safeTransferFrom(agent, vault, allocated + pnl)`. When `allocated = 0` and `pnl = 0`, it tries to transfer 0 — which still reverts if the vault's precondition on `agentAllocation` fails.

**Fix:** Removed all calls to `reportSettlement(agentId, 0)` from:
- The "not allocated this cycle" early-return path
- The "real_trades_disabled" early-return path

In both `apps/agent-pythia/src/index.ts` and `apps/agent-demeter/src/index.ts`.

---

### 6. Stale Vault Allocations (Over-Allocated State)

**Problem:** `tsx --watch` restarts agent processes on file edits, killing in-flight cycles mid-hold. The on-chain `agentAllocation` entries remain set (settle never ran). After several such interruptions, `totalDeployed` exceeded `totalAssets`, leaving `liquidReserve = $0`.

**Observed state:**
```
vault totalAssets:  $30
vault liquidReserve: $0
hermes alloc: $24
demeter alloc: $12
```

**Recovery:** Manually force-settled each stale agent via the allocator:
```bash
curl -X POST http://localhost:3001/settle \
  -H "Content-Type: application/json" \
  -d '{"agentId":"hermes","pnlUsd":0}'

curl -X POST http://localhost:3001/settle \
  -H "Content-Type: application/json" \
  -d '{"agentId":"demeter","pnlUsd":0}'
```

**Prevention:** Do not edit source files while agents are in their hold period. tsx restarts kill the cycle.

---

### 7. TraceAnchor anchor() Always Reverts

**Problem:** All three agents log `on-chain anchor failed: missing revert data` on every cycle.

**Root cause:** The currently-deployed `TraceAnchor` at `0x87704aB48dE82aBa4FaF3ba81E1edbD37935195c` predates the Phase 1 auth change. Its `anchor()` selector doesn't match the new ABI (which requires the caller to be a registered agent).

**Status:** Non-fatal — already caught in each agent's `anchor.ts` with `console.warn`. Proposals are still submitted and the cycle continues normally. Not fixed; redeployment would require a migration plan.

---

### 8. Haiku JSON Markdown Fences

**Problem:** Claude Haiku sometimes wraps JSON responses in markdown fences (` ```json ... ``` `), causing `JSON.parse()` to throw in agent reasoning loops.

**Fix:** Strip leading/trailing fences before parsing in the agent `reason.ts` files.

**Commit:** `fix(agents): strip markdown fences from Haiku JSON output` (`9439df6`)

---

### 9. Indexer "filter not found" Errors

**Problem:** Indexer logs `@TODO Error: could not coalesce error (filter not found)` repeatedly.

**Root cause:** Arc testnet does not persist `eth_newFilter` filters across reconnects. The indexer's `eth_getFilterChanges` calls reference expired filter IDs.

**Status:** Non-fatal — indexer continues operating. Not fixed; would require switching to `eth_getLogs` polling.

---

## Contracts (Arc Testnet)

| Contract | Address |
|---|---|
| ThemisVault | `0x54120530B0A114bbA1cC2Fe30B93f4ac4b6eb8Fe` |
| ThemisRegistry | `0x48fCCa251c5FFF968d39bF9a527045becbe7d761` |
| TraceAnchor (stale) | `0x87704aB48dE82aBa4FaF3ba81E1edbD37935195c` |

---

## Key Configuration

| Setting | Value |
|---|---|
| `ENABLE_REAL_TRADES` | `true` |
| `AGENT_CYCLE_MS` | 1,200,000 ms (20 min) |
| `HERMES_HOLD_MS` | 600,000 ms (10 min) |
| `PYTHIA_HOLD_MS` | 600,000 ms (10 min) |
| `DEMETER_HOLD_MS` | 900,000 ms (15 min) |
| Arc RPC | `https://rpc.testnet.arc.network` |
| HL Exchange | `https://api.hyperliquid-testnet.xyz/exchange` |

---

## Utility Scripts Added

### `scripts/vault-state.ts`

Reads on-chain vault state and per-agent allocation/sidelined/walletUsdc:
```bash
pnpm tsx scripts/vault-state.ts
```

---

## Current Soak Test State (as of ~22:00 2026-05-24)

```
vault totalAssets:  $30.00
vault liquidReserve: $1.00

hermes   alloc=$14.77  deposited=$10  walletUsdc=$68.99  sidelined=false
pythia   alloc=$5.00   deposited=$10  walletUsdc=$70.00  sidelined=false  ← vault stale, allocator=$0
demeter  alloc=$9.23   deposited=$10  walletUsdc=$29.99  sidelined=false

Allocator:
  hermes:  trades=2  alloc=$14.77  stuck=None  lastPnl=$0.000000
  pythia:  trades=4  alloc=$0.00   stuck=None  lastPnl=$0.000000
  demeter: trades=4  alloc=$9.23   stuck=None  lastPnl=$0.000000
```

**Active cycle:** hermes and demeter in hold period (opened positions ~22:00). Pythia not allocated this cycle. Expected settlements at ~22:10 (hermes) and ~22:15 (demeter).

**First successful cycles observed:** hermes trades=2, demeter trades=4, pythia trades=4. No stuck agents. PnL ≈ $0.000 (simulated — price movement near zero over 10-15 min hold).

---

## Operations Runbook

### Clear a stuck agent
```bash
curl -X POST http://localhost:3001/stuck \
  -H "Content-Type: application/json" \
  -d '{"agentId":"<hermes|pythia|demeter>","reason":null}'
```

### Force-settle a stale vault allocation
```bash
curl -X POST http://localhost:3001/settle \
  -H "Content-Type: application/json" \
  -d '{"agentId":"<hermes|pythia|demeter>","pnlUsd":0}'
```

### Check allocator state
```bash
curl -s http://localhost:3001/state | python3 -c "
import sys, json, time
d = json.load(sys.stdin)
now = time.time() * 1000
for k, v in d['agentStates'].items():
    age = int((now - v.get('lastSettleTs',0)) / 1000) if v.get('lastSettleTs') else -1
    print(f\"{k}: trades={v['tradesCompleted']} alloc=\${v['currentAllocationUsd']:.2f} stuck={v['stuckReason']} lastPnl=\${v.get('lastPnlUsd',0):.4f} ({age}s ago)\")
"
```

### Check vault on-chain state
```bash
pnpm tsx scripts/vault-state.ts
```

---

## What's NOT Working (Accepted Tradeoffs)

| Issue | Impact | Decision |
|---|---|---|
| USYC Teller rejects deposits | Demeter yield is simulated (5.2% APY model) | Accepted — usyc_sim fallback |
| HL L1 has no margin | Hermes/Pythia PnL is real price movement, no actual fills | Accepted — simulated fill at mark price |
| TraceAnchor has wrong ABI | IPFS hash anchoring silently fails | Accepted — non-fatal warn |
| Indexer filter expiry | Indexer events may be missed on reconnect | Accepted — cosmetic for demo |
| CCTP not end-to-end tested | Bridge direction untested under real load | Pre-fund approach avoids this |
