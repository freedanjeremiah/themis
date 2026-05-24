# Phase 2 — Real PnL Design

**Date:** 2026-05-24
**Author:** Romario Kavin (with Claude Code)
**Status:** Design approved, awaiting plan
**Depends on:** Phase 1 Foundation (merged as `97fba80`)

## Context

Phase 1 made the vault the real USDC custody point: `allocate()` transfers USDC to the agent, `settle()` pulls `allocated + pnl` back. The off-chain pipeline is executable end-to-end. But all three agents still emit synthetic PnL (`direction * confidence * size * 0.005`-style fallbacks), which makes the allocator's Sharpe-based scoring game itself.

Phase 2 replaces every synthetic settlement with a real one: USYC delta for Demeter, realized HL perp PnL for Hermes/Pythia. To make this work end-to-end with the Phase 1 vault model, capital really moves: vault → agent (Arc) → CCTP → HL testnet → trade → CCTP → agent → vault.

## Scope decisions

| Question | Decision |
|---|---|
| Capital flow shape | **Long cycle, full roundtrip.** Each cycle completes: vault → agent → CCTP → HL → trade → hold → close → CCTP → agent → vault. Preserves Phase 1's vault-custody invariant. |
| Cycle duration | 20 min (env-configurable: `AGENT_CYCLE_MS`). |
| Hold period | 10 min within cycle (env-configurable per agent). |
| Trade venue (Hermes/Pythia) | Hyperliquid testnet. |
| Trade venue (Demeter) | USYC Teller on Arc testnet. |
| Synthetic-PnL fallbacks | Deleted, not gated. A failed cycle settles 0 PnL and surfaces a `stuck` flag. |
| Failure recovery | Agent emits `stuck` event; operator runs `scripts/cctp-recover.ts`; admin can `forceSettle` once capital is back. |
| Shared HL client | Extracted into `packages/hl-client/` (deduplicate Hermes + Pythia). |
| HL mainnet config | Demoted to commented-out fallback in `.env.example`. Testnet is default. |

## Target architecture changes from Phase 1

### Per-cycle timing — Hermes and Pythia (20 min cycle, 10 min hold)

```
T+00:00  agent reasons, anchors trace, submits proposal
T+00:05  allocator scores, vault.allocate transfers USDC to agent Arc wallet
T+00:10  agent CCTP burn on Arc, begins attestation poll
T+02:00  CCTP mint on HL testnet (~60–120s typical)
T+02:05  agent places HL perp order via EIP-712 phantom-agent signing
T+12:05  hold window ends; agent closes HL position; reads realized PnL via /info
T+12:10  agent CCTP burn on HL, begins attestation poll
T+14:10  CCTP mint on Arc back to agent wallet
T+14:15  agent POSTs settle-ready { agentId, pnlUsdc6 } to allocator
T+14:20  allocator calls vault.settle(agent, realizedPnl)
T+20:00  next cycle starts
```

### Per-cycle timing — Demeter (20 min cycle, ~15 min hold)

```
T+00:00  reason → propose
T+00:05  allocator scores, vault.allocate transfers USDC to Demeter Arc wallet
T+00:10  Demeter approves USYC teller, teller.deposit(amount), records sharesHeld
T+15:00  teller.redeem(sharesHeld), receives USDC delta
T+15:05  POST settle-ready
T+15:10  allocator calls vault.settle(demeter, usdcDelta)
T+20:00  next cycle
```

### Real-PnL settlement per agent

- **Hermes / Pythia:** read realized PnL from HL `/info` POST `{type:"clearinghouseState", user:agent.address}` after close. PnL = `entryNotional − exitNotional ± fees`, settled as int6.
- **Demeter:** USDC delta from `teller.redeem(shares)`. No synthetic APY math.

### Synthetic-PnL deletions

| File | Lines to delete |
|---|---|
| `apps/agent-hermes/src/index.ts` | the fallback PnL formula around 53–66 |
| `apps/agent-pythia/src/index.ts` | the fallback formula around 40–70 |
| `apps/agent-demeter/src/index.ts` | the simulated-APY block around 34–42 |

After Phase 2, no `Math.random()` and no `confidence * size * X` formulas exist in any agent's settlement path.

### Failure handling

- **CCTP burn succeeds, attestation never lands** within `ATTESTATION_TIMEOUT_MS` (default 600_000 = 10 min): agent logs the burn tx hash + destination domain, POSTs `stuck:cctp_attestation_timeout` to allocator, holds capital on current chain. Operator runs `pnpm tsx scripts/cctp-recover.ts <agent> <burnTxHash>` to manually poll Iris and call `receiveMessage`.
- **HL order rejected/unfilled:** agent skips the cycle, reverses the bridge, settle(0).
- **HL close fails (network/API):** agent retries 3× with 30s backoff; on final failure, emits `stuck:hl_close_failed`.
- **Reverse bridge fails:** capital sits on HL until operator runs recovery script; agent stays stuck.
- **Cascading stuck state:** agent stops submitting proposals while stuck. Dashboard shows `sidelined: true` (with stuck reason in tooltip — Phase 3 polish).

### Pythia headline freshness

Replace the static `"Crypto markets steady, no major moves"` fallback with a last-real cache at `apps/agent-pythia/.headline-cache.json`. If Twitter + RSS both fail AND cache is older than 30 min, skip the cycle entirely (no proposal submitted) rather than reasoning on stale data.

### Shared HL client

Extract `apps/agent-hermes/src/hl.ts` and the duplicate `apps/agent-pythia/src/hl.ts` into a new workspace package `packages/hl-client/`:

```
packages/hl-client/
  src/
    index.ts         re-exports
    client.ts        constructor: HlClient({apiUrl, wallet, chainId})
    sign.ts          EIP-712 phantom-agent signing
    orders.ts        placeHlOrder, closeHlOrder
    info.ts          getMidPrice, getUserPositions, getClearinghouseState
  package.json
  tsconfig.json
```

Both agents import: `import { HlClient } from "@themis/hl-client";`.

### HL testnet env switch

`.env.example` adds a testnet-default block, demotes mainnet to commented fallback:

```env
# Hyperliquid (testnet by default — flip to mainnet by uncommenting the alternate block)
HYPERLIQUID_API_URL=https://api.hyperliquid-testnet.xyz
HYPERLIQUID_EXCHANGE_URL=https://api.hyperliquid-testnet.xyz/exchange
HYPERLIQUID_INFO_URL=https://api.hyperliquid-testnet.xyz/info
HYPERLIQUID_CHAIN_ID=998
DEST_RPC_URL=https://rpc.hyperliquid-testnet.xyz/evm

# CCTP V2 (testnet)
HYPERLIQUID_CCTP_DOMAIN=19
MESSAGE_TRANSMITTER_DEST=0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275

# --- Mainnet alternative (commented) ---
# HYPERLIQUID_API_URL=https://api.hyperliquid.xyz
# HYPERLIQUID_CHAIN_ID=999
# DEST_RPC_URL=https://rpc.hyperliquid.xyz/evm
# MESSAGE_TRANSMITTER_DEST=0x81D40F21F12A8F0E3252Bccb954D722d4c464B64
```

### Stuck-agent tracking (allocator)

Allocator gains:
- `POST /stuck { agentId, reason }` endpoint
- `state.markStuck(agentId, reason)` / `state.clearStuck(agentId)` methods backed by SQLite (`agent_state.stuck_reason TEXT NULL` column)
- `cycle.ts` filters stuck agents from scoring (same way it filters sidelined agents)
- `GET /agents` includes `stuck: string | null` field for dashboard

Dashboard wires `stuck` into the leaderboard's sidelined badge for Phase 2; visual polish lands in Phase 3.

### CCTP recovery scripts

- `scripts/verify-cctp-testnet.ts` — one-time spike, runs before T2.4 implementation. Does a $1 USDC burn from Arc testnet → polls Iris → mints on HL testnet. Confirms domain IDs, attestation URL, and `MESSAGE_TRANSMITTER_DEST`. Writes results to `docs/cctp-testnet.md`.
- `scripts/cctp-recover.ts <agentId> <burnTxHash>` — operator-run when an agent emits a stuck event. Re-polls Iris for the attestation and calls `receiveMessage` on the destination chain.

### Daily loss cap end-to-end test

New `apps/contracts/test/DailyLossCap.integration.test.ts` that simulates a full cycle on hardhat: deposit 100, allocate 100, settle −6 → asserts `AgentSidelined` event AND the next `allocate(agent, X, Y)` reverts with `"agent sidelined"`. Verifies the on-chain enforcement still works after the Phase 1 vault-funding-model change.

## Files this phase touches

```
apps/agent-hermes/src/index.ts             real PnL, deleted fallback, env-driven timing
apps/agent-hermes/src/execute.ts           adds reverse-bridge step
apps/agent-pythia/src/index.ts             same
apps/agent-pythia/src/execute.ts           same
apps/agent-pythia/src/data.ts              headline cache + skip
apps/agent-demeter/src/index.ts            real shares-delta PnL
apps/agent-demeter/src/execute.ts          track sharesHeld, redeem path
apps/allocator/src/server.ts               new POST /stuck endpoint
apps/allocator/src/state.ts                stuck flag + markStuck/clearStuck
apps/allocator/src/db.ts                   add stuck_reason column
apps/allocator/src/cycle.ts                filter stuck agents
apps/contracts/test/DailyLossCap.integration.test.ts  NEW
packages/hl-client/                        NEW (extracted from agent-hermes/hl.ts)
scripts/cctp-recover.ts                    NEW
scripts/verify-cctp-testnet.ts             NEW (one-time spike)
.env.example                               HL testnet defaults; mainnet commented
docs/cctp-testnet.md                       NEW (spike results)
```

## Definition of done

**24-hour soak on testnet.** All three agents complete ≥10 cycles each. Every settlement traces to a real USYC delta or a real HL position open/close. No `Math.random()` and no synthetic-PnL formula remain in agent code paths. Dashboard shows live PnL based on real numbers. Operator has run `scripts/cctp-recover.ts` at least once successfully against a deliberately stuck cycle.

## Out of scope (deferred)

- Reasoning theater UX (Phase 3).
- Dashboard "stuck agent" visual polish (Phase 3; Phase 2 only flips the boolean).
- Auto-recovery of stuck CCTP burns (manual script in Phase 2).
- HL WebSocket subscriptions (we poll `/info`, simpler and good enough at 20-min cycle pace).
- Per-agent reasoning model selection (Claude Haiku across all three, as today).

## Open risks

1. **HL testnet API differences from mainnet.** Possible: different fee schedule, different chainId for EIP-712, slower fills. Mitigation: the `scripts/verify-cctp-testnet.ts` spike + first Hermes cycle on testnet (T2.4 first commit) surface this before Pythia inherits.
2. **CCTP testnet reliability.** Iris attestations may be slower or flakier on testnet. Mitigation: longer `ATTESTATION_TIMEOUT_MS` default (10 min); recovery script + admin `forceSettle` escape valve.
3. **24-hour soak surfacing bugs not in unit tests.** Mitigation: structured logs already in place from Phase 1; consider adding a single Discord webhook alert on agent stuck (out of scope for plan, optional).
4. **Demeter cycle dependency on USYC liquidity.** If USYC teller has insufficient liquid USDC at redeem time, redeem reverts. Mitigation: low allocation sizes ($10–50) keep us well under teller liquidity.
