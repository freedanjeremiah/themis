# Real Arc-testnet path — operator runbook

How to take Themis from a fresh checkout to live agents trading on Arc testnet
with `ENABLE_REAL_TRADES=true`. The dashboard is verified to build and render;
the on-chain flow (deposit → allocate → settle) is verified end-to-end on a
local hardhat node. This runbook covers wiring the real testnet.

> Agents trade Hyperliquid perps against **pre-funded HyperEVM testnet wallets**
> (no CCTP bridge). HL fills are simulated at live mark price when the HL L1
> margin account is empty, so PnL tracks real price movement. USYC Teller
> deposits fall back to a 5.2%-APY model if the testnet Teller rejects them.
> All on-chain vault accounting, allocation, scoring, and settlement is real.

## 0. Prerequisites

- Node ≥ 22.5, pnpm 11.2.2 (`corepack enable`)
- `pnpm install` at the repo root
- Funding sources:
  - Arc testnet USDC (gas) for the allocator + 3 agent wallets — Circle faucet: https://faucet.circle.com/
  - HyperEVM testnet USDC for the 3 agent wallets (for perp trading)
- API keys: Anthropic (agent reasoning), Pinata (IPFS trace pinning), optionally Twitter (Pythia news)

## 1. Configure env

```bash
cp .env.example .env
```

Fill in `.env`:

| Key | Source |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `PINATA_JWT` | app.pinata.cloud (optional — traces anchor as `hash://` without it) |
| `TWITTER_BEARER_TOKEN` | developer.twitter.com (optional — Pythia falls back to RSS/cache) |
| `PRIVATE_KEY_ALLOCATOR` / `_HERMES` / `_PYTHIA` / `_DEMETER` | `pnpm tsx scripts/create-wallets.ts`, or your own keys |
| `AGENT_ADDRESS_HERMES` / `_PYTHIA` / `_DEMETER` | the addresses for those keys (printed by create-wallets) |
| `CIRCLE_API_KEY` / `CIRCLE_ENTITY_SECRET` / `CIRCLE_WALLET_SET_ID` | only if using Circle Developer-Controlled Wallets |

`VAULT_ADDRESS` / `REGISTRY_ADDRESS` / `ANCHOR_ADDRESS` are filled automatically by step 3.

> **Critical:** each `AGENT_ADDRESS_*` must be the exact address of the matching
> `PRIVATE_KEY_*`. The indexer maps on-chain events to agents by `AGENT_ADDRESS_*`;
> a mismatch silently drops every event. Preflight (step 5) checks this.

## 2. Fund the wallets

- Allocator + each agent: send Arc testnet USDC (gas).
- Each agent: send HyperEVM testnet USDC (perp collateral).

A few dollars each is plenty for a 24-hour soak.

## 3. Deploy fresh contracts

```bash
cd apps/contracts
pnpm hardhat run ../../scripts/deploy.ts --network arc
cd ../..
```

This deploys a fresh ThemisVault + ThemisRegistry + TraceAnchor (current ABI,
registry-gated), registers the three agents, and **writes the addresses into
`.env` and `apps/dashboard/.env.local`** automatically.

> A fresh deploy is the right move for a demo — it gives a working TraceAnchor
> (the long-deployed `0x8770…` one has the pre-Phase-1 ABI and reverts on every
> `anchor()` call) and a clean vault with no stale allocations.

## 4. Approve the vault

Each agent must approve the vault to pull USDC during `settle()`:

```bash
pnpm approve-vault all
```

## 5. Preflight

```bash
pnpm preflight
```

This validates everything that caused "stuck on cycle 1" during soak:
required env, RPC + chainId, contract code, **agent address↔key match**,
registry registration, `vault.allocator()` wiring, vault approvals, and Arc gas
balances. Fix every `✗` before continuing. Expected ending:

```
Preflight PASSED — safe to start agents.
```

## 6. Bring up the stack

Dry-run first (no real venue calls — agents log intent, settle $0):

```bash
ENABLE_REAL_TRADES=false pnpm dev
```

Watch the dashboard at http://localhost:3000 and the logs. Once a full cycle
completes cleanly (propose → allocate → settle), flip to live:

```bash
# set ENABLE_REAL_TRADES=true in .env, then:
pnpm dev
```

`pnpm dev` runs `predev` (compiles contracts + syncs ABIs) then starts all six
processes via Turborepo: indexer (:3002), allocator (:3001), the three agents,
and the dashboard (:3000).

## 7. Observe

```bash
pnpm vault-state          # on-chain TVL, per-agent allocation, sidelined, wallet USDC
curl -s localhost:3001/state | jq        # allocator view (trades, pnl, stuck)
curl -s localhost:3002/agents | jq       # indexer view (what the dashboard reads)
```

Cycle pace is 20 minutes (`AGENT_CYCLE_MS`). First settlements land ~10–15 min
after the first proposals.

## Recovery

**Don't edit agent source while a cycle is mid-hold** — `tsx --watch` restarts
the process, the on-chain `agentAllocation` stays set, and `liquidReserve`
drops. If that happens, force-settle the stale allocation:

```bash
curl -X POST localhost:3001/settle -H 'Content-Type: application/json' \
  -d '{"agentId":"hermes","pnlUsd":0}'
```

**Clear a stuck agent** (allocator stops scoring it until cleared):

```bash
curl -X POST localhost:3001/stuck -H 'Content-Type: application/json' \
  -d '{"agentId":"hermes","reason":null}'
```

**Un-sideline** an agent that breached the −5% daily loss cap (admin only):
call `vault.unsidelineAgent(<agentAddress>)` from the admin wallet.

## Production hosting

For an always-on deployment, see `infra/README.md` (docker-compose for the
backend services + Caddy TLS) and deploy the dashboard to Vercel with
`NEXT_PUBLIC_VAULT_ADDRESS`, `NEXT_PUBLIC_INDEXER_URL`, `NEXT_PUBLIC_INDEXER_WS_URL`,
and `NEXT_PUBLIC_FAUCET_URL` set in the project settings.
