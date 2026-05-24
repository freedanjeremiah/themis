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
- **Vault model**: `allocate()` on `ThemisVault.sol` **updates accounting only — it does NOT move USDC** out of the vault to the agent. Agents must already hold USDC in their own wallet to execute trades; the vault tracks `agentAllocation[agent]` as a bookkeeping balance. `settle()` adjusts `totalAssets` by reported PnL. This diverges from a literal reading of the PRD but is intentional for the hackathon timeline. If you change this, also change every agent's `execute.ts` (CCTP source wallet).
- **Daily loss cap (−5%)** is enforced **on-chain** in `ThemisVault.settle()` (L109–115), not in the allocator. `state.sidelineAgent()` in `allocator/src/state.ts:59` is dead code — the on-chain `agentSidelined` flag is the source of truth, and any subsequent `allocate()` reverts.
- **Trade execution is gated by `ENABLE_REAL_TRADES=true`** in `.env`. Default is `false`: agents log what they would do but skip CCTP bridging and HL order placement. Always honor this flag in any new execute code path.
- **Agent identity**: agents are identified off-chain by `AgentId = "hermes" | "pythia" | "demeter"` and on-chain by their EOA address. The indexer maps address → id via env vars; if `AGENT_ADDRESS_*` is wrong, events are silently dropped (`indexer/src/poller.ts:39`).

## Known traps (read before editing)

1. **`packages/shared/src/abis/*.json` are empty `[]`.** Every off-chain service (allocator, indexer, all three agents, `scripts/register-agents.ts`, `scripts/set-allocator.ts`) imports from `@themis/shared/abis`. With an empty ABI, *any* contract method call will throw at runtime. Hardhat compiles real ABIs into `apps/contracts/artifacts/contracts/<Contract>.sol/<Contract>.json` but there is no copy/sync step. Before running anything off-chain end-to-end, either (a) populate those three JSON files from artifacts, or (b) wire a postinstall/predev step that does it. The dashboard has its own inline ABIs in `apps/dashboard/src/lib/abis.ts` so it works in isolation.

2. **PnL reported to `vault.settle()` is synthetic.** All three agents fall back to formulae like `direction * confidence * size * 0.005` when no real position closes (`agent-hermes/src/index.ts:35-66`, `agent-pythia/src/index.ts:40-70`, `agent-demeter/src/index.ts:34-42`). This means the allocator's Sharpe-based scoring is gaming itself. If you fix this, fix it in all three agents.

3. **`apps/dashboard/src/components/CircleKitDeposit.tsx` is cosmetic.** It adds a "Powered by Circle" badge but delegates to a custom wagmi-based `DepositPanel`. There is no real Circle App Kit `SendTransactionForm` integration (the 2-step approve→deposit doesn't fit Send's UX). Don't claim App Kit Send is integrated.

4. **`scripts/e2e.ts` does NOT exercise the full flow.** It POSTs three hardcoded mock proposals to the allocator and reads the indexer. No deposit, no on-chain allocate, no settle. Don't use it to verify end-to-end correctness.

5. **Allocator state is in-memory only.** `allocator/src/state.ts` resets `pnlHistory` and `tradesCompleted` on every restart, so Sharpe is unreliable across restarts. Persist to SQLite or rehydrate from indexer if you care about continuity.

6. **`TraceAnchor.anchor()` has no auth** — any caller can anchor any agent's traces. Acceptable for hackathon; flag if hardening.

7. **Aave is not deployed on Arc testnet.** `agent-demeter/src/data.ts:101-117` falls back to mock APYs (520/480 bps with block-number noise) if `AAVE_POOL_ADDRESS` is unset. USYC Teller is real and works.

8. **Pythia's data fallback is identical every cycle.** When Twitter and RSS both fail, `data.ts:49` returns `[{ title: "Crypto markets steady, no major moves" }]`. Claude then produces identical proposals every cycle. Consider caching the last real headline instead.

9. **`register-agents.ts` is redundant** — `scripts/deploy.ts` already registers all three agents (L55-67). Don't run both.

10. **Indexer DB lives at `apps/indexer/themis.db`** (file-backed via `node:sqlite`). Delete the file to reset state. Requires Node ≥ 22.5 for the built-in `node:sqlite` import.

## Deployed contracts (Arc testnet)

| Contract | Address |
|---|---|
| ThemisVault | `0x54120530B0A114bbA1cC2Fe30B93f4ac4b6eb8Fe` |
| ThemisRegistry | `0x48fCCa251c5FFF968d39bF9a527045becbe7d761` |
| TraceAnchor | `0x87704aB48dE82aBa4FaF3ba81E1edbD37935195c` |

Don't redeploy unless you must — depositors are on these addresses.

## Common tasks

- **Run everything**: `pnpm dev` from repo root.
- **Run one service**: `cd apps/<app> && pnpm dev`.
- **Compile contracts + regenerate artifacts**: `cd apps/contracts && pnpm hardhat compile`. Then sync ABIs into `packages/shared/src/abis/*.json` (see trap #1).
- **Run contract tests**: `cd apps/contracts && pnpm hardhat test`. Only `ThemisVault.test.ts` and `TraceAnchor.test.ts` exist; `ThemisRegistry` has no tests.
- **Run allocator scorer tests**: `cd apps/allocator && pnpm vitest`.
- **Smoke test allocator + indexer**: `pnpm tsx scripts/e2e.ts` (HTTP only, see trap #4).
- **Deploy contracts (rare)**: `cd apps/contracts && pnpm hardhat run ../../scripts/deploy.ts --network arc`.

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

- Editing a contract → recompile → **sync ABI to `packages/shared/src/abis/`** → restart all off-chain services.
- Editing `packages/shared/src/types.ts` → all apps consume this; rebuild Turbo cache if anything is stale (`pnpm turbo build --force`).
- Editing `.env` → restart every service; nothing watches it.
- Touching trade execution paths → keep `ENABLE_REAL_TRADES=false` until you've stared at the diff. Real CCTP bridges burn USDC on the source chain.

## Today's deadline

Hackathon submission is **2026-05-25**. Prioritize: working demo > new features > polish > tests. If you're more than 30 minutes into a refactor, stop and ask whether it's needed before the deadline.
