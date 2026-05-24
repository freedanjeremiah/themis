# CLAUDE.md

Guidance for Claude Code when working in this repository. The README is the user-facing intro; this file is for engineers (human or AI) editing the codebase.

## What this is

Themis is a multi-agent on-chain hedge fund on Arc testnet. Three off-chain AI agents (`hermes`, `pythia`, `demeter`) submit trade proposals every 60s. An off-chain allocator scores them and calls `ThemisVault.allocate()` on Arc. PnL is reported back via `ThemisVault.settle()`. Reasoning traces are pinned to IPFS and hash-anchored via `TraceAnchor`.

Built for the Agora hackathon (deadline **2026-05-25** — today is 2026-05-24). Hackathon-grade code: optimize for shipping, not robustness.

PRD: `2026-05-23-themis-prd.md` (single source of truth for scope).

## Monorepo layout

```
apps/
  contracts/      Hardhat. ThemisVault, ThemisRegistry, TraceAnchor + ERC20Mock.
  allocator/      Node + Express. Scores proposals, calls vault.allocate/settle.
  agent-hermes/   Funding-rate arb, Hyperliquid perps via CCTP V2.
  agent-pythia/   News-reactive trader, Twitter + RSS data, HL perps via CCTP V2.
  agent-demeter/  Stablecoin yield rotator, USYC Teller on Arc.
  indexer/        ethers event listener + node:sqlite + Express REST + ws.
  dashboard/      Next.js 14 App Router + wagmi v2.
packages/
  shared/         Types + ABIs (see "Known traps" below).
scripts/          create-wallets, deploy, register-agents, set-allocator, e2e.
```

`pnpm` workspaces + Turborepo. `pnpm dev` runs everything; each app also has its own `pnpm dev`.

## Architecture invariants

- **Chain**: Arc testnet, chain ID **5042002**. USDC (`0x36...0000`) is the **native gas token** — there is no Paymaster and no separate gas token. Treat `chain.nativeCurrency` as USDC in any new wagmi/viem config.
- **Vault is the real USDC custody point** (Phase 1). `ThemisVault.allocate(agent, amount, cycleId)` does `usdc.safeTransfer(agent, delta)` after a `liquidReserve` precondition check; the agent's wallet really holds the allocated USDC. `settle(agent, pnl)` does `usdc.safeTransferFrom(agent, vault, allocated + pnl)` — so on a gain the agent returns `allocated + |pnl|`, on a loss the agent returns `allocated − |loss|`, vault net delta is always `pnl`. The agent must `approve(vault, MAX)` once after registration — use `scripts/approve-vault.ts <agentId>`.
- **Daily loss cap (−5%)** is enforced **on-chain** in `ThemisVault.settle()` (search for `LOSS_CAP_BPS`). After a breach, `agentSidelined[agent] = true` and any subsequent `allocate()` reverts. The off-chain allocator does not need to enforce this — the on-chain flag is the source of truth.
- **Pause coverage**: `deposit`, `withdraw`, `allocate`, and `settle` all carry the `notPaused` modifier. `forceSettle(agent, pnl)` is an admin-only escape that bypasses the pause for wind-down (same accounting as settle, no daily reset, no sideline).
- **TraceAnchor is registry-gated**: `anchor(hash, cid)` requires `msg.sender` to be a registered agent in `ThemisRegistry`. The agent address argument is gone — the contract reads it from `msg.sender`.
- **Trade execution is gated by `ENABLE_REAL_TRADES=true`** in `.env`. Default is `false`: agents log what they would do but skip CCTP bridging and HL order placement. Always honor this flag in any new execute code path.
- **Agent identity**: agents are identified off-chain by `AgentId = "hermes" | "pythia" | "demeter"` and on-chain by their EOA address. The indexer maps address → id via env vars; if `AGENT_ADDRESS_*` is wrong, events are silently dropped (`indexer/src/poller.ts:39`).

## Known traps (read before editing)

1. **Aave is not deployed on Arc testnet.** `agent-demeter/src/data.ts` falls back to mock APYs (520/480 bps with block-number noise) if `AAVE_POOL_ADDRESS` is unset. USYC Teller is real and works.

2. **Indexer DB lives at `apps/indexer/themis.db`** (file-backed via `node:sqlite`). Allocator DB lives at `apps/allocator/state.db`. Delete files to reset state. Requires Node ≥ 22.5 for the built-in `node:sqlite` import.

3. **The currently-deployed on-chain `TraceAnchor` at `0x87704aB48dE82aBa4FaF3ba81E1edbD37935195c` predates the Phase 1 auth change** — its constructor took no args and its `anchor()` had a different signature. Any redeploy MUST use the new ABI (registry address in constructor; `anchor(hash, cid)` only). Documented depositors are still on the old vault; redeploy only with a migration plan.

4. **Cycle pace is 20 min** (`AGENT_CYCLE_MS` env, default `1_200_000`). The 60s pace from the PRD is gone — Phase 3 onboarding UX accounts for this slower rhythm.

5. **Agents skip the CCTP bridge — they trade against pre-funded HL testnet wallets.** The original Phase 2 design had Hermes/Pythia bridge USDC Arc↔HL every cycle via CCTP V2. Soak testing exposed too many failure modes (CCTP V2 7-param signature mismatch, Iris testnet latency, stuck mid-roundtrip state). The pre-fund approach (commit `03f467a`) wins: each agent wallet holds USDC on HyperEVM (chain 998) directly. Agents skip `bridgeArcToHl`/`bridgeHlToArc` entirely. Vault accounting on Arc tracks economics correctly; PnL settles back via `vault.settle`. The reverse-CCTP env vars (`CCTP_TOKEN_MESSENGER_HL`, `MESSAGE_TRANSMITTER_ARC`, `USDC_ADDRESS_HL`) are now ignored in the live path — leave them blank.

6. **HL perp fills are simulated at mark price.** HL L1 margin requires a separate margin deposit which none of the agent wallets have. `packages/hl-client/src/client.ts` falls back to logging `SIMULATED fill at mark price` when an IOC order doesn't fill, returning the live mark price as the synthetic fill. PnL = real mark-price movement over the hold window, with no real margin or fees. Honest framing: agents trade "shadow" positions on real HL price data.

7. **USYC Teller deposits revert on testnet (KYC/whitelist gated).** `apps/agent-demeter/src/execute.ts` wraps `teller.deposit` in try/catch; on revert it falls back to `venue: "usyc_sim"` with `sharesHeld = amountUsdc6`. `redeemFromVenue("usyc_sim")` computes a 5.2%-APY model yield over the hold window. The on-chain `vault.settle` still receives a real PnL number derived from this simulated yield.

8. **The deployed `TraceAnchor` at `0x87704aB48dE82aBa4FaF3ba81E1edbD37935195c` has the old (pre-Phase-1) ABI.** Every cycle's `anchor()` call reverts with "missing revert data". Non-fatal — each agent's `anchor.ts` catches with `console.warn` and proceeds. The on-chain hash anchoring is silently broken. Redeploy with the new ABI when the existing depositors can migrate.

9. **Do not edit agent source files while a cycle is in its hold period.** `tsx --watch` (the default `pnpm dev`) restarts the agent process on any file change, killing the cycle mid-hold. The on-chain `agentAllocation` stays set, settle never fires, and `liquidReserve` drops. Recovery requires a manual force-settle: `curl -X POST $ALLOCATOR_URL/settle -d '{"agentId":"<id>","pnlUsd":0}'`. Edit during the brief proposal/score window or take the cycle down first.

10. **Stuck-agent recovery is manual.** When an agent hits `stuck`, the allocator stops scoring it. Clear with: `curl -X POST http://localhost:3001/stuck -d '{"agentId":"<id>","reason":null}'`. The `scripts/cctp-recover.ts` tool is only relevant if you bring CCTP back online.

11. **Indexer logs "filter not found" errors continuously.** Arc testnet doesn't persist `eth_newFilter` filters across reconnects, and ethers' filter-based subscriptions reference expired IDs. Non-fatal — indexer keeps running. Fix would require switching to `eth_getLogs` polling.

12. **`scripts/vault-state.ts` is the operator's main inspection tool.** Run `pnpm tsx scripts/vault-state.ts` to see TVL, liquidReserve, per-agent allocation, sidelined flag, and wallet USDC balance — all read live from the vault contract.

### Phase 1 + Phase 2 + Phase 3 changes

**Phase 1** fixed: empty shared ABIs (auto-synced via `pnpm abis`, enforced in CI); vault didn't actually move USDC (now `allocate` transfers, `settle` pulls back); cosmetic `CircleKitDeposit` wrapper (deleted); fake `e2e.ts` (now real round-trip against hardhat node); in-memory allocator state (now SQLite); `TraceAnchor` had no auth (now registry-gated); redundant `register-agents.ts` (deleted).

**Phase 2** fixed: synthetic PnL formulas in all three agents (removed); `hl.ts` duplicated in two agents (now `packages/hl-client/`); HL mainnet defaults in `.env.example` (now testnet, mainnet commented); CCTP one-way only (added `bridgeHlToArc` — but later abandoned in soak testing, see trap #5); allocator had no stuck-agent surface (now SQLite-persisted `stuckReason` + `POST /stuck` + cycle filter); Pythia identical-cycle headline fallback (now last-real cache + `StaleHeadlinesError` skips cycle); agents used `requestedSizeUsd` even when allocator scaled down (now read `vault.agentAllocation` after the allocate-wait).

**Soak-test reality (post-Phase-2)** — see `docs/session-log-2026-05-24.md` for full details. The pre-Phase-2 design imagined three agents doing full real CCTP roundtrips and real HL perps. Soak testing under deadline pressure forced pragmatic substitutions: pre-funded HL wallets instead of CCTP (trap #5); simulated HL fills at live mark price instead of real margin (trap #6); USYC sim fallback instead of working Teller deposit (trap #7); TraceAnchor anchor still silently broken (trap #8); manual force-settle workflow for stale allocations (trap #9). The on-chain vault accounting, allocator scoring, dashboard wiring, and PnL flow all remain real — only the venue execution layer is partially simulated.

**Phase 3** reshaped the dashboard for first-time visitors:
- New layout: `DisclaimerBanner` (top) → `TvlBar` → `OnboardingStrip` (auto-hides after first deposit) → main grid `[ReasoningTheater 2/3 + (CompactLeaderboard + DepositPanel) 1/3]` → `ActivityTicker` (fixed bottom).
- New components: `AgentBadge` (hover tooltip with thesis), `TraceCard` (big confidence-bar card), `WhyExpandable` (lazy IPFS reasoning disclosure via React Query + 3-gateway race), `ReasoningTheater` (skeleton + WS status header), `CompactLeaderboard` (sparkline sidebar), `OnboardingStrip` (Connect→AddArc→USDC→$10 flow), `WsStatusIndicator` (green/amber/red dot), `DisclaimerBanner` (dismissable testnet warning).
- Single source of truth for agent display in `apps/dashboard/src/lib/agent-meta.ts` (`AGENT_META`).
- Deposit prefill drives `<DepositPanel prefilledAmount={10} prefillNonce={n} />` — the nonce changes on every click so re-presses re-fill the input.
- New env var `NEXT_PUBLIC_FAUCET_URL` (operator: replace with the canonical Arc faucet URL when available; defaults to docs link).
- Deleted: `TracesFeed.tsx` (superseded by ReasoningTheater + TraceCard), `AgentLeaderboard.tsx` (superseded by CompactLeaderboard).

## Deployed contracts (Arc testnet)

| Contract | Address |
|---|---|
| ThemisVault | `0x54120530B0A114bbA1cC2Fe30B93f4ac4b6eb8Fe` |
| ThemisRegistry | `0x48fCCa251c5FFF968d39bF9a527045becbe7d761` |
| TraceAnchor | `0x87704aB48dE82aBa4FaF3ba81E1edbD37935195c` |

Don't redeploy unless you must — depositors are on these addresses.

## Common tasks

- **Run everything**: `pnpm dev` from repo root. (Triggers `predev` → `pnpm abis` → contracts compile + ABIs sync.)
- **Run one service**: `cd apps/<app> && pnpm dev`.
- **Compile + sync ABIs explicitly**: `pnpm abis` from repo root.
- **Run contract tests**: `cd apps/contracts && pnpm hardhat test` (21 tests across `ThemisVault`, `ThemisRegistry`, `TraceAnchor`).
- **Run allocator tests**: `cd apps/allocator && pnpm test` (8 tests across `scorer`, `state`).
- **Real end-to-end test** (vault round-trip on local hardhat): in one terminal `cd apps/contracts && pnpm hardhat node`; in another from repo root `pnpm tsx scripts/e2e.ts`. Should end with `=== PHASE 1 END-TO-END PASSED ===`.
- **Agent approves vault (one-time after wallet funding)**: `pnpm tsx scripts/approve-vault.ts <hermes|pythia|demeter>`.
- **Deploy contracts to Arc testnet (rare)**: `cd apps/contracts && pnpm hardhat run ../../scripts/deploy.ts --network arc`.

## Tech choices

- **Solidity 0.8.24**, OpenZeppelin v5, custom errors, manual share math (not ERC-4626-inheriting).
- **ethers v6** in all off-chain Node services. **wagmi v2 + viem v2** in dashboard. Don't mix.
- **Anthropic SDK** with **Claude Haiku** for agent reasoning (`agent-*/src/reason.ts`). Keep prompts short — these run every 60s per agent.
- **CCTP V2** for Arc → HyperEVM bridging. EIP-712 phantom-agent signing for HL orders (`hl.ts`).
- **node:sqlite** in indexer (no `better-sqlite3`, no native build).
- **Recharts** for sparklines. **CountUp** for TVL animation. **Tailwind v3** (don't upgrade to v4 — there was a recent build break with `@circle-libs/react-elements` that pulled in conflicting tailwind).

## Code conventions

- TS strict mode everywhere. `.js` extension on relative imports in ESM packages (allocator, indexer, shared) — `import { foo } from "./bar.js"` resolves to `bar.ts` under Node's NodeNext resolver.
- Money values: store USDC amounts as raw `bigint` (6-decimal integers) until display. The dashboard divides by `1e6` only in JSX. The indexer schema stores raw integers too.
- Console logging convention: `[<service>] message`, e.g. `[allocator] cycle 42 ...`.
- No comments unless the *why* is non-obvious. The codebase already follows this — keep it.

## What is intentionally missing (do NOT add unprompted)

- No DAO/governance UI.
- No mobile-responsive layout. Desktop dashboard only.
- No reputation NFT.
- No allocator → contract atomicity (allocate + USDC transfer is split by design here).
- No agent plug-in surface for third-party submissions.

## When changing things

- Editing a contract → `pnpm abis` (compiles + syncs ABIs automatically) → restart all off-chain services. CI fails if the shared ABIs drift from compiled artifacts.
- Editing `packages/shared/src/types.ts` → all apps consume this; rebuild Turbo cache if anything is stale (`pnpm turbo build --force`).
- Editing `.env` → restart every service; nothing watches it.
- Touching trade execution paths → keep `ENABLE_REAL_TRADES=false` until you've stared at the diff. Real CCTP bridges burn USDC on the source chain.
- After deploying a fresh agent wallet → run `pnpm tsx scripts/approve-vault.ts <agentId>` so the vault can pull USDC back during `settle()`. Without this, every settle reverts.

## Today's deadline

Hackathon submission is **2026-05-25**. Prioritize: working demo > new features > polish > tests. If you're more than 30 minutes into a refactor, stop and ask whether it's needed before the deadline.
