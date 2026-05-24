# Themis — AI Agent Arena on Arc

> *A marketplace where AI agents compete for capital, in public, on Arc.*

Built for the **Agora Agents Hackathon · Canteen × Circle** (deadline 2026-05-25).

Three specialized AI agents continuously propose trades. The best track record wins more capital. Every reasoning step is hash-anchored on-chain. Anyone can deposit, withdraw, or just watch.

---

## What it is

A single USDC vault on Arc testnet. Three AI agents — each with a different thesis — submit trade proposals every 60 seconds. An allocator scores them by recent Sharpe ratio and confidence, then routes capital to the top-2 winners. Losers keep a 1% consolation budget so they can keep building track record. All decisions are published to IPFS and their hashes anchored on-chain.

| Agent | Thesis | Venue |
|---|---|---|
| **Hermes** | Funding-rate arb — long the cheap side, short the expensive side | Hyperliquid perps via CCTP |
| **Pythia** | News-reactive ETH/BTC perp trader | Hyperliquid perps via CCTP |
| **Demeter** | Stablecoin yield rotator — park idle capital for yield | USYC teller on Arc |

---

## Architecture

```
┌─────────────────────────────────────────┐
│        Dashboard  (Next.js + wagmi)      │
│  TVL · Leaderboard · Traces · Deposit   │
└──────────────────────┬──────────────────┘
                       │ REST + WebSocket
        ┌──────────────┴──────────────┐
        ▼                             ▼
┌──────────────────┐       ┌──────────────────────┐
│  ThemisVault.sol │◀──────│  Indexer             │
│  ThemisRegistry  │       │  Node.js + SQLite    │
│  TraceAnchor     │       │  REST + WS server    │
└──────────────────┘       └──────────────────────┘
        ▲                             ▲
        │                             │
┌───────┴────────────────────────────┐
│          Allocator service          │
│  scores proposals · calls vault     │
└───────┬─────────────┬──────────────┘
        │             │             │
   ┌────┴───┐   ┌─────┴──┐   ┌─────┴───┐
   │ Hermes │   │ Pythia  │   │ Demeter │
   └────────┘   └─────────┘   └─────────┘
```

**Monorepo layout:**

```
apps/
  agent-hermes/     funding-rate arb agent
  agent-pythia/     news-reactive agent
  agent-demeter/    yield rotation agent
  allocator/        scores proposals, calls vault.allocate()
  indexer/          reads Arc events, serves REST + WebSocket
  dashboard/        Next.js 14 frontend
  contracts/        Hardhat project (ThemisVault, ThemisRegistry, TraceAnchor)
packages/
  shared/           shared TypeScript types
scripts/
  create-wallets.ts provisions Circle developer-controlled wallets
  deploy.ts         deploys contracts to Arc testnet
```

---

## Deployed contracts (Arc testnet · chain ID 5042002)

| Contract | Address |
|---|---|
| `ThemisVault` | `0x54120530B0A114bbA1cC2Fe30B93f4ac4b6eb8Fe` |
| `ThemisRegistry` | `0x48fCCa251c5FFF968d39bF9a527045becbe7d761` |
| `TraceAnchor` | `0x87704aB48dE82aBa4FaF3ba81E1edbD37935195c` |

**Arc testnet addresses:**

| Token / Protocol | Address |
|---|---|
| USDC (native gas token) | `0x3600000000000000000000000000000000000000` |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| USYC | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` |
| USYC Teller | `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A` |
| CCTP TokenMessengerV2 | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` |

---

## Circle stack

| Product | Where it's used |
|---|---|
| **Developer-Controlled Wallets** | One sub-wallet per agent + allocator admin wallet |
| **CCTP V2** | Bridge USDC Arc → HyperEVM when Hermes/Pythia win allocation |
| **USYC** | Demeter rotates idle USDC into yield via the USYC Teller |
| **App Kit** | Deposit/withdraw panel in the dashboard |
| **USDC** | All settlement, all gas (Arc uses USDC natively) |

---

## Prerequisites

- Node.js ≥ 20
- pnpm ≥ 11 (`npm i -g pnpm`)
- A funded Arc testnet wallet (get USDC from the Arc faucet)

---

## Setup

**1. Clone and install:**

```bash
git clone <repo>
cd themis
pnpm install
```

**2. Configure environment:**

```bash
cp .env.example .env
```

Fill in the required values in `.env`:

| Variable | How to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `PINATA_JWT` | [app.pinata.cloud](https://app.pinata.cloud) — for IPFS trace pinning |
| `CIRCLE_API_KEY` | [console.circle.com](https://console.circle.com) → API Keys |
| `CIRCLE_ENTITY_SECRET` | Circle Console → Developer Wallets → Entity Secret |
| `TWITTER_BEARER_TOKEN` | (optional) Twitter developer portal — Pythia falls back to mock headlines without it |

Contract addresses, wallet keys, and RPC URLs are already filled from the testnet deployment.

**3. Provision agent wallets** *(skip if using the pre-generated keys in `.env`)*:

```bash
pnpm tsx scripts/create-wallets.ts
```

Fund the three agent wallets with a small amount of USDC for gas. Addresses are printed by the script and stored in `AGENT_ADDRESS_*` env vars.

**4. Deploy contracts** *(skip — already deployed to Arc testnet)*:

```bash
cd apps/contracts
pnpm hardhat run ../../scripts/deploy.ts --network arc
```

---

## Running locally

Start all services at once with Turborepo:

```bash
pnpm dev
```

Or start each service individually in separate terminals:

```bash
# Dashboard — http://localhost:3000
cd apps/dashboard && pnpm dev

# Indexer — http://localhost:3002
cd apps/indexer && pnpm dev

# Allocator
cd apps/allocator && pnpm dev

# Agents
cd apps/agent-hermes  && pnpm dev
cd apps/agent-pythia  && pnpm dev
cd apps/agent-demeter && pnpm dev
```

The dashboard works standalone (it degrades gracefully when the indexer or agents are offline).

**Enable live trading:**

Set `ENABLE_REAL_TRADES=true` in `.env`. Default is `false` — agents log what they would do without executing.

---

## How allocation works

Every 60 seconds:

1. Each agent fetches its data source and asks Claude to produce a trade proposal with a confidence score and reasoning trace.
2. The reasoning trace is pinned to IPFS and its hash is anchored on Arc via `TraceAnchor`.
3. The proposal is submitted to the allocator.
4. The allocator scores all proposals:

```
if trades_completed < 10:
    score = 0.6 × confidence + 0.4 × diversification_bonus   # bootstrap
else:
    score = 0.5 × sharpe + 0.3 × confidence + 0.2 × diversification_bonus
```

5. Top-2 proposals win capital allocation. The rest receive 1% consolation to stay active.
6. Winning agents execute their trade. After the hold period, positions close and PnL is settled back to the vault.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 App Router, Tailwind CSS v3, wagmi v2, viem v2, Recharts |
| Agents / services | Node.js, TypeScript, ethers v6, Anthropic SDK |
| Contracts | Solidity 0.8, OpenZeppelin, Hardhat |
| Database | Node.js built-in SQLite (`node:sqlite`) |
| CCTP signing | msgpackr + EIP-712 phantom agent signing |
| Monorepo | pnpm workspaces + Turborepo |
| Chain | Arc testnet (chain ID 5042002) + HyperEVM (chain ID 999) |

---

## Safety

- Deposits capped at **$100 per wallet**, **$5,000 total vault**.
- Each agent has a daily loss cap of **−5%** of its allocation before being sidelined.
- Vault is pausable by admin.
- `ENABLE_REAL_TRADES=false` by default — no live execution without explicit opt-in.
- Contracts are unaudited hackathon prototypes. Do not deposit funds you can't afford to lose.

---

## License

MIT
