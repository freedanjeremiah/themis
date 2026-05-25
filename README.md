<div align="center">

# Themis

### An autonomous, multi-agent hedge fund on Arc

*Three AI agents compete for real on-chain capital. Every decision is published with its full reasoning. Risk is enforced by the contract, not by trust.*

[![Live demo](https://img.shields.io/badge/demo-live-2ea44f?style=flat-square)](https://themis-arc.vercel.app)
[![Chain](https://img.shields.io/badge/chain-Arc%20testnet%20·%205042002-4f7cff?style=flat-square)](https://testnet.arcscan.app)
[![Settlement](https://img.shields.io/badge/settles%20in-USDC-2775ca?style=flat-square)](https://www.circle.com/usdc)
[![License](https://img.shields.io/badge/license-MIT-555?style=flat-square)](#license)

**[→ Open the live app](https://themis-arc.vercel.app)** · Built for the Agora Agents Hackathon (Canteen × Circle)

</div>

---

## What it is

Themis is a single USDC vault on Arc with three AI agents trading on top of it. Each cycle, every agent asks an LLM for a trade, publishes a proposal with a conviction score and a written rationale, and an off-chain allocator scores the proposals and moves real testnet USDC into the strongest ideas. Profit and loss settle back on-chain, in public. You can watch the agents reason, judge their track record, and back the fund yourself.

The point isn't "an AI that makes money." It's an agent-run fund you can **audit**: read why each call was made, verify it on-chain, and trust that risk limits are enforced by code.

| Agent | Beat | Venue |
|---|---|---|
| **Hermes** | Funding-rate arbitrage — long the cheap side, short the expensive side of perp funding | Hyperliquid testnet perps |
| **Pythia** | News-reactive ETH/BTC perp trader — reads Twitter + RSS, asks the model what it means | Hyperliquid testnet perps |
| **Demeter** | Stablecoin yield rotator — parks idle capital for yield while the others trade | USYC Teller on Arc |

---

## Live deployment

| Surface | URL |
|---|---|
| **Dashboard** | https://themis-arc.vercel.app |
| **Indexer API (REST)** | https://themis.philotheephilix.in/api |
| **Indexer (WebSocket)** | wss://themis.philotheephilix.in/api |

**Network:** Arc testnet · chain ID `5042002` · RPC `https://rpc.testnet.arc.network` · explorer [testnet.arcscan.app](https://testnet.arcscan.app)
USDC is the **native gas token** on Arc, so the vault custodies USDC directly with no paymaster. Get testnet USDC from the [Circle faucet](https://faucet.circle.com/).

---

## Deployed contracts (Arc testnet)

| Contract | Address | Explorer |
|---|---|---|
| `ThemisVault` | `0x54120530B0A114bbA1cC2Fe30B93f4ac4b6eb8Fe` | [view ↗](https://testnet.arcscan.app/address/0x54120530B0A114bbA1cC2Fe30B93f4ac4b6eb8Fe) |
| `ThemisRegistry` | `0x48fCCa251c5FFF968d39bF9a527045becbe7d761` | [view ↗](https://testnet.arcscan.app/address/0x48fCCa251c5FFF968d39bF9a527045becbe7d761) |
| `TraceAnchor` | `0x87704aB48dE82aBa4FaF3ba81E1edbD37935195c` | [view ↗](https://testnet.arcscan.app/address/0x87704aB48dE82aBa4FaF3ba81E1edbD37935195c) |

**Agent wallets**

| Agent | Address | Explorer |
|---|---|---|
| Hermes | `0xD5B9468c9AB26e7BAcA0e20cF75efbD344Bb4e32` | [view ↗](https://testnet.arcscan.app/address/0xD5B9468c9AB26e7BAcA0e20cF75efbD344Bb4e32) |
| Pythia | `0xC151883eB825453e267EB2D8638774e70Ecf2D76` | [view ↗](https://testnet.arcscan.app/address/0xC151883eB825453e267EB2D8638774e70Ecf2D76) |
| Demeter | `0x2DDC1071Df0E9aFfAa92aBC4Ba70f66060d3cB85` | [view ↗](https://testnet.arcscan.app/address/0x2DDC1071Df0E9aFfAa92aBC4Ba70f66060d3cB85) |

**Tokens / protocols on Arc testnet**

| Asset | Address |
|---|---|
| USDC (native gas token) | [`0x3600000000000000000000000000000000000000`](https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000) |
| USYC | [`0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C`](https://testnet.arcscan.app/address/0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C) |
| USYC Teller | [`0x9fdF14c5B14173D74C08Af27AebFf39240dC105A`](https://testnet.arcscan.app/address/0x9fdF14c5B14173D74C08Af27AebFf39240dC105A) |

---

## How it works

Each cycle (every ~20 minutes on the deployed config):

1. Each agent pulls its data source and asks **Claude** for a trade: an instrument, a direction, a size, a conviction score, and a written rationale.
2. The rationale is pinned to **IPFS** and forwarded to the indexer, so every decision is readable and attributable.
3. The proposal goes to the **allocator**, which scores all three:
   ```
   trades < 10:   score = 0.6·confidence + 0.4·diversification        (bootstrap)
   otherwise:     score = 0.5·sharpe + 0.3·confidence + 0.2·diversification
   ```
4. The allocator calls `ThemisVault.allocate()`, which transfers real testnet USDC to the winning agents. Weaker proposals keep a small consolation budget so they can build a track record.
5. Agents run their positions, then `ThemisVault.settle()` pulls the stake back plus or minus PnL.
6. **Risk is on-chain:** any agent down more than **5% in a day** is auto-sidelined by the contract and can't be funded again until the day resets.

```
                  ┌──────────────────────────────────────────────┐
                  │     Dashboard · Next.js + wagmi (Vercel)      │
                  │   Reasoning Desk · Standings · TVL · Invest   │
                  └───────────────────────┬──────────────────────┘
                                          │ REST + WebSocket
                  ┌───────────────────────┴──────────────────────┐
                  │     Indexer · ethers + node:sqlite            │
                  │     getLogs polling → REST/WS                 │
                  └───────────────────────┬──────────────────────┘
                                          │ reads events
   ┌──────────────────────────────────────┴───────────────────────┐
   │   ThemisVault · ThemisRegistry · TraceAnchor   (Arc testnet)  │
   └──────────────────────────────────────┬───────────────────────┘
                                          │ allocate / settle
                  ┌───────────────────────┴──────────────────────┐
                  │   Allocator · scores proposals, calls vault   │
                  └──────┬─────────────────┬─────────────────┬────┘
                     ┌───┴────┐       ┌────┴───┐       ┌─────┴────┐
                     │ Hermes │       │ Pythia │       │ Demeter  │
                     └────────┘       └────────┘       └──────────┘
```

---

## What's real vs simulated

Honest framing, because this runs on a testnet:

**Real and on-chain:** the vault and all custody, deposits, allocations, and settlements (real USDC transfers and share math); the daily loss cap and auto-sideline enforcement; agent reasoning (real LLM calls); the live indexer + dashboard; and market data (agents act on live Hyperliquid mark prices).

**Simulated on testnet:** perp **fills** are simulated at the live mark price (the agents hold no Hyperliquid L1 margin), and Demeter's USYC yield is modeled because the testnet Teller is access-gated. So PnL tracks real price movement on real on-chain capital, with no real fills or fees.

> The original design bridged USDC Arc → HyperEVM via **CCTP V2** every cycle. Under deadline pressure we swapped it for pre-funded HyperEVM wallets (chain 998) after CCTP testnet latency caused stuck round-trips. The Arc-side vault accounting stayed real.

---

## Monorepo layout

```
apps/
  contracts/      Hardhat — ThemisVault, ThemisRegistry, TraceAnchor (Solidity 0.8.24, OZ v5)
  allocator/      Node + Express — scores proposals, calls vault.allocate/settle
  agent-hermes/   funding-rate arbitrage agent
  agent-pythia/   news-reactive agent (Twitter + RSS)
  agent-demeter/  stablecoin yield agent (USYC)
  indexer/        ethers event poller + node:sqlite + REST + WebSocket
  dashboard/      Next.js 14 App Router + wagmi v2
packages/
  shared/         shared types + synced contract ABIs
  hl-client/      Hyperliquid client (EIP-712 signing)
scripts/          deploy, create-wallets, approve-vault, preflight, e2e
infra/            Docker Compose + Caddy (auto-TLS) for the backend
```

---

## Tech stack

| Layer | Tech |
|---|---|
| Contracts | Solidity 0.8.24, OpenZeppelin v5, Hardhat |
| Agents / services | Node.js, TypeScript, ethers v6, Anthropic SDK (Claude Haiku) |
| Indexer | `node:sqlite` (built-in, no native build), Express, `ws` |
| Frontend | Next.js 14 App Router, wagmi v2, viem v2, Tailwind v3, Recharts |
| Infra | Docker Compose + Caddy (backend VM), Vercel (dashboard) |
| Monorepo | pnpm workspaces + Turborepo |
| Chain | Arc testnet (`5042002`), USDC-native gas |

---

## Run it locally

**Prerequisites:** Node.js ≥ 22.5 (the indexer uses the built-in `node:sqlite`), pnpm ≥ 11.

```bash
git clone <repo> && cd themis
pnpm install
cp .env.example .env     # add ANTHROPIC_API_KEY and PINATA_JWT; contract addresses are prefilled
```

Start everything with Turborepo:

```bash
pnpm dev
```

Or run services individually:

```bash
cd apps/dashboard && pnpm dev    # http://localhost:3000
cd apps/indexer   && pnpm dev    # http://localhost:3002
cd apps/allocator && pnpm dev    # http://localhost:3001
cd apps/agent-hermes  && pnpm dev
cd apps/agent-pythia  && pnpm dev
cd apps/agent-demeter && pnpm dev
```

The dashboard degrades gracefully when the indexer or agents are offline. Trade execution is gated behind `ENABLE_REAL_TRADES=true` (default `false`: agents log what they would do without executing). Before a real bring-up, run `pnpm preflight` to validate env, RPC, contract wiring, and approvals.

Deploy contracts (already done on testnet; only needed for a fresh chain):

```bash
cd apps/contracts && pnpm hardhat run ../../scripts/deploy.ts --network arc
```

---

## Safety

- Deposits are capped at **$100 per wallet**.
- On-chain daily loss cap of **−5%** per agent, enforced in `ThemisVault.settle()`; the vault is admin-pausable.
- Trade execution is off by default (`ENABLE_REAL_TRADES=false`).
- These are **unaudited hackathon contracts on a test network**. Testnet USDC has no real value. Don't deposit anything you can't afford to lose.

---

## License

MIT
