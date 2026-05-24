# Themis — End-User-Usable Production Design

**Date:** 2026-05-24
**Author:** Romario Kavin (with Claude Code)
**Status:** Design approved, awaiting plan

## Context

Themis is an AI-agent trading arena on Arc testnet built for the Agora hackathon (deadline 2026-05-25). A code audit on 2026-05-24 found the project broadly tracks PRD scope but ships several critical defects: empty shared-ABI files block every off-chain contract call; `ThemisVault.allocate()` updates accounting without transferring USDC; all three agents settle synthetic PnL even with `ENABLE_REAL_TRADES=true`; the `CircleKitDeposit` wrapper is cosmetic; `e2e.ts` exercises only the HTTP layer; allocator state is in-memory.

This design covers the post-hackathon work to make the platform **end-user usable as a testnet showcase**: a third-party visitor can land on the dashboard, understand what's happening, get testnet USDC, deposit, watch real agents trade real testnet positions, and withdraw — running 24/7 from a single deploy.

## Scope decisions

| Question | Decision |
|---|---|
| Time horizon | Multi-week roadmap. No deadline pressure. |
| Capital model | **Testnet only.** No real money. No mainnet. Sidesteps custody and securities risk. |
| Agent scope | **All three agents real on Hyperliquid testnet.** Hermes/Pythia bridge via real CCTP V2 testnet; Demeter uses USYC Teller on Arc testnet. No synthetic PnL anywhere. |
| UX scope | **Frictionless onboarding + reasoning theater.** Mobile, OG-card social, status pages explicitly deferred. |
| Hosting | **Minimal deploy.** Dashboard on Vercel; everything else on a single VM via docker-compose. |
| Sequencing | **Approach A — Foundation → Real PnL → UX → Deploy → Hardening.** Sequential phases, no parallel tracks. |

## Target architecture

### Changes from current state

- **Vault becomes the real custody point.** `allocate()` transfers USDC to the agent wallet under a `liquidReserve` precondition. `settle()` pulls `allocated + pnl` USDC back via `transferFrom` (the agent had received `allocated` on allocate; on a gain returns more, on a loss returns less, vault delta = pnl). The "agent pre-funded out-of-band" flow is deleted.
- **Shared ABIs are the single source of truth.** A `scripts/sync-abis.ts` reads Hardhat artifacts and writes `packages/shared/src/abis/*.json`. Hooked into `predev` / `prebuild` / `postinstall`. The dashboard deletes its inline ABI in `apps/dashboard/src/lib/abis.ts` and imports from `@themis/shared/abis`.
- **Allocator persists state** to `apps/allocator/state.db` (node:sqlite). Tables for agent state and PnL history. On startup, hydrate in-memory state from disk so Sharpe survives restarts.
- **Agents settle real PnL only.** Synthetic fallbacks deleted (not gated). Demeter reads `convertToAssets` deltas; Hermes/Pythia close real HL testnet positions and settle realized PnL.
- **Dashboard gains** an onboarding strip and a reasoning-theater panel.
- **One deploy target:** Vercel for dashboard, single VM with `infra/docker-compose.yml` for indexer + allocator + 3 agents.

### Explicit non-goals

- Mainnet. Arc testnet + HL testnet only.
- Mobile-responsive layout. Desktop only.
- Third-party agent plug-in surface.
- ERC-4626 interface inheritance on vault.
- Multi-region / Kubernetes / sophisticated infra.
- Real Circle App Kit Send integration. The cosmetic `CircleKitDeposit.tsx` wrapper is deleted; deposit panel keeps honest "uses Circle stack" attribution only.
- KYC, audit, legal review.

### Component diff

```
apps/contracts     unchanged Solidity; allocate() + settle() gain USDC transfer + reserve check;
                   allocate/settle gain notPaused; TraceAnchor gains registered-agent auth
apps/allocator     + state.db (SQLite); fixed vault calls; deletes dead sideline code
apps/agent-*       real-PnL settle; deleted synthetic fallbacks; cached real headline (Pythia)
apps/indexer       unchanged structure; events on the new TraceAnchor auth flow
apps/dashboard     + onboarding strip; + reasoning theater; deletes inline ABIs
packages/shared    ABIs now populated via prebuild hook
scripts/           + sync-abis.ts; + approve-vault.ts; + fund-agents.ts;
                   e2e.ts becomes a real end-to-end; register-agents.ts deleted
infra/             NEW. docker-compose.yml + Dockerfiles for the 5 services
docs/              + user-facing "how Themis works" doc; + ops runbook; + cctp-testnet notes
.github/workflows/ NEW. typecheck + tests + ABI-sync check + deploy hook
```

## Phases

### Phase 1 — Foundation (~1 week)

Make the off-chain pipeline executable end-to-end. No demo improvements.

| # | Deliverable |
|---|---|
| 1.1 | ABI sync script (`scripts/sync-abis.ts`); wired as `predev`/`prebuild`/postinstall; CI fails if artifacts and shared ABIs diverge |
| 1.2 | Vault funding-model change: `allocate()` adds `usdc.safeTransfer(agent, amount)` + `liquidReserve` precondition; `settle()` adds `safeTransferFrom(agent, address(this), allocated + pnl)` (signed math; vault net delta = pnl); agent must `approve(vault, MAX)` once. Helper: `scripts/approve-vault.ts` |
| 1.3 | Pause coverage: `notPaused` modifier on `allocate()` and `settle()`; admin `forceSettle()` escape valve |
| 1.4 | Allocator persistence: `apps/allocator/state.db` (node:sqlite); `agent_state` + `pnl_history` tables; hydrate on startup |
| 1.5 | Delete dead code: `state.sidelineAgent()`, `scripts/register-agents.ts`, `CircleKitDeposit.tsx` |
| 1.6 | Real `scripts/e2e.ts` against a local hardhat node (no HL/CCTP dependency yet): deposit from a test wallet → submit a hand-crafted proposal → assert allocator emits `Allocated` event → submit a hand-crafted settle → assert `Settled` event → assert indexer + dashboard `/agents` updated. Phase 2 extends this to real cycles |
| 1.7 | Vault tests: cap revert, negative-PnL settle, multi-allocate-per-day, daily reset boundary, sidelined revert, `liquidReserve` insufficiency on allocate; add `ThemisRegistry` tests; add `TraceAnchor` auth test |
| 1.8 | TraceAnchor auth: require `msg.sender` registered in `ThemisRegistry` |

**Done when:** `pnpm tsx scripts/e2e.ts` passes on a fresh checkout against a hardhat node, with no synthetic-PnL code present in agents.

### Phase 2 — Real PnL (~2 weeks)

Every PnL number is computed from a real on-chain or exchange position.

| # | Deliverable |
|---|---|
| 2.1 | Demeter real PnL: track `shares_held`; `teller.deposit(amount)` on win; `teller.redeem(shares)` at end of hold; settle USDC delta |
| 2.2 | HL testnet env switch: parameterize `HYPERLIQUID_API_URL`, `DEST_RPC_URL`, `HYPERLIQUID_CHAIN_ID`, `MESSAGE_TRANSMITTER_DEST`, `HYPERLIQUID_CCTP_DOMAIN` for HL testnet; document in `.env.example` |
| 2.3 | CCTP V2 testnet end-to-end manual walk; documented in `docs/cctp-testnet.md`; verified `MESSAGE_TRANSMITTER_DEST = 0xE737…` |
| 2.4 | Hermes real HL testnet execution: `placeOrder` + `closePosition`; settle = realized PnL from HL `/info` user state; synthetic fallback deleted |
| 2.5 | Pythia real HL testnet execution: same wiring; extract shared HL client into `packages/hl-client` or `apps/shared-hl/` |
| 2.6 | Pythia headline freshness: cache last real headline; skip cycle if cache age > 30min |
| 2.7 | Vault → agent capital flow: allocate transfers → agent bridges via CCTP → trades → closes → bridges back → settle pulls USDC back. End-to-end loop verified per agent |
| 2.8 | Per-agent daily loss cap end-to-end test: deliberately lose 6%, assert sideline event + next allocate reverts; verify allocator handles revert and dashboard shows sidelined badge |

**Done when:** 24h soak on testnet — all three agents complete ≥10 cycles each, every settlement traces to a real position open/close, dashboard reflects the result.

### Phase 3 — Onboarding + Reasoning Theater UX (~1 week)

A Twitter visitor lands, understands, and either deposits or watches.

| # | Deliverable |
|---|---|
| 3.1 | Onboarding strip: connect wallet → add Arc testnet → get testnet USDC (faucet link + copy-address) → pre-filled $10 deposit. Progress in localStorage |
| 3.2 | Reasoning theater panel: live trace cards over WebSocket; trade_idea in large font; confidence bar; expandable "Why?" with full reasoning trace from IPFS |
| 3.3 | `useTrace(cid)` hook: React Query, multi-gateway fallback, in-memory cache |
| 3.4 | Agent narrative tooltips from `AGENT_META` constant |
| 3.5 | Live activity ticker (bottom bar): recent events |
| 3.6 | Empty/loading states across every panel; WS reconnect indicator |
| 3.7 | Honest disclaimers: "Arc testnet — testnet USDC only" banner; replace any "Powered by Circle App Kit Send" claim |

**Done when:** 60-second screen capture of new visitor → onboarding → first deposit, no console errors, reasoning theater visibly streams.

### Phase 4 — Deploy (~3 days)

Dashboard URL up 24/7, agents run 24/7, automatic restarts.

| # | Deliverable |
|---|---|
| 4.1 | Dockerfiles for allocator, indexer, agent-hermes/pythia/demeter (Node 22-alpine, non-root, healthcheck) |
| 4.2 | `infra/docker-compose.yml`: 5 services + Caddy/Traefik for HTTPS on indexer REST/WS; volumes for `themis.db` and `allocator/state.db` |
| 4.3 | Single-VM provider (Fly.io or Hetzner); `docs/ops-runbook.md`; DNS for `indexer.themis.example` |
| 4.4 | Dashboard on Vercel with `NEXT_PUBLIC_INDEXER_URL`/`_WS_URL` pointing at public indexer domain |
| 4.5 | Secrets in VM `.env` outside repo; rotation docs for `ANTHROPIC_API_KEY`, `PINATA_JWT`, `CIRCLE_API_KEY`, `PRIVATE_KEY_*` |
| 4.6 | `restart: unless-stopped`; 60s graceful shutdown handler for allocator + agents (finish cycle, persist state) |
| 4.7 | Log persistence: stdout → vector or loki → Grafana Cloud free tier |
| 4.8 | GitHub Actions CI: typecheck + contract tests + allocator vitest + ABI-sync check on PR; deploy hook on `main` push |

**Done when:** push to `main` → CI green → dashboard updates within 5 minutes; services auto-restart on crash; indexer + allocator state survives `docker compose down && up`.

### Phase 5 — Hardening + observability (ongoing)

- Structured logs (`pino`); `/health` + `/metrics` per service; Grafana dashboard for cycle latency, allocate/settle success rate, IPFS pin success, HL error rate
- Discord/Slack webhook alert on >5min service down or `AgentSidelined`
- Key rotation; documented 30-second pause procedure
- User-facing "How Themis works" doc; ops runbook; per-agent strategy explainer

## Risks and deferred decisions

1. **HL testnet reliability.** If flaky, treat downtime as part of the agora narrative (sidelined cycles) rather than mocking. Decision: option (a).
2. **IPFS pinning cost.** 3 agents × 1440 cycles/day ≈ 130k pins/month. Pinata free tier is insufficient. Budget ~$20/mo or self-host Kubo.
3. **Anthropic spend.** ~8.6M Haiku tokens/day ≈ ~$3/day. Acceptable; add a budget alert.
4. **Vault funding-model change is breaking.** If `0x5412…` has existing depositors, need a migration vault or documented redeposit flow. Verify depositor count before Phase 1 starts.
5. **CCTP fees vs allocation size.** With $50–100 allocations, fees can exceed PnL. Mitigation: minimum allocation size or longer hold periods.

## Definition of "end-user usable"

A visitor arriving from a tweet can, with no prior context:
1. Reach the dashboard URL and see live activity within 3 seconds.
2. Read agent thesis and recent reasoning without leaving the page.
3. Click through onboarding → testnet USDC → deposit in under 90 seconds.
4. Watch their deposit appear in TVL, see allocation events, see settlements (real PnL).
5. Withdraw at any time without an error.

No console errors during the path above. Services run 24/7. The narrative is honest — no claims of features that don't work.
