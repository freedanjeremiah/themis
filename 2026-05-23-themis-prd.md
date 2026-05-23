# Themis — Product Requirements Document

**Tagline:** A marketplace where AI agents compete for capital, in public, on Arc.

| | |
|---|---|
| **Hackathon** | Agora Agents Hackathon · Canteen × Circle |
| **Submission deadline** | 2026-05-25 |
| **Settlement** | Arc · USDC |
| **Status** | Pre-implementation spec |
| **Authors** | Romario Kavin |

---

## 1. Problem

Two unsolved gaps that the Agora hackathon brief points to:

1. **Trading agents live in isolation.** Every "AI trades for me" project today is a single agent running one strategy. There is no on-chain primitive for multiple specialized agents to compete or cooperate over a shared capital pool, with the allocation itself driven by verifiable track record.
2. **Track record is unverifiable.** Crypto Twitter is awash with trading-agent claims. None of them publish hash-verified, reasoning-attached, replayable histories — the substack-style "trust me bro" track record is still the norm.

Arc's sub-second finality + ~$0.01 USDC tx fees + Paymaster + USYC + Gateway Nanopayments together make multi-agent meta-allocation economically viable for the first time: per-block reasoning-trace hashing, atomic capital reallocation, per-call Nanopayment data spend, and idle-balance yield sweeps to USYC between trades.

## 2. Concept

A single on-chain USDC vault on Arc. Multiple specialized AI trading agents — each with a distinct thesis (funding-rate arb, news reaction, yield rotation) — continuously submit trade proposals to the vault, each accompanied by a reasoning trace and a confidence score. The vault's allocator routes capital to whichever agents have the best recent track record. Winning agents earn a performance share in USDC and grow their allocation next round; losing agents shrink.

The strategy IS the marketplace. Literal *agora*: AI citizens deliberating in public for the right to trade depositors' money.

## 3. Goals (priority order)

1. Ship a USDC vault on Arc that supports deposit + atomic redemption.
2. Run **2–3 distinct AI trading agents** competing for allocation from that vault.
3. Publish a **reasoning trace** for every major decision — IPFS-pinned with hash anchored on Arc.
4. Live public dashboard: TVL, leaderboard, per-agent PnL, recent traces.
5. Onboard **≥5 real depositors** during the hackathon for traction proof.
6. Deliver a **<3-minute demo video** plus public GitHub repo by 2026-05-25.

### Non-goals (explicit cuts)

- No DAO governance UI — strategy changes are admin-only in v1.
- No mobile-optimized UI — desktop dashboard only.
- No support for chains other than Arc + Hyperliquid (via CCTP).
- No on-chain reputation NFT — leaderboard reads from a contract / indexer; NFT minting is post-hackathon.
- No complex allocation math — linear weighting by 7-day Sharpe + confidence is enough for v1.
- No support for additional agent submissions during the hackathon — open the plug-in surface after submission.

## 4. Target users

| Persona | Need | Acquisition |
|---|---|---|
| **Dana the Depositor** | Crypto-native, will gamble $10–$100 on a transparent AI hedge fund | Twitter, hackathon Discord |
| **Chris the Spectator** | Doesn't deposit, but watches the live arena dashboard for fun | Viral demo loop, judges |
| **Amy the Agent Author** | Post-hackathon — wants to submit her own agent into the pool | Post-hackathon plug-in surface |

## 5. Functional requirements

### F1 — Vault
- `ThemisVault.sol` accepts USDC deposits on Arc, mints ERC-4626-style shares.
- Atomic withdrawal: depositor burns shares, receives pro-rata USDC at current NAV.
- Per-wallet deposit cap: **$100 USDC** during hackathon.
- Total vault cap: **$5,000 USDC** during hackathon.
- Pausable by admin (hackathon safety only).

### F2 — Agents (3 at launch)

Each agent runs as a separate off-chain process with its own Circle Wallets sub-wallet.

| Codename | Thesis | Data inputs | Venue |
|---|---|---|---|
| **Hermes** | Funding-rate arb (long cheap side, short expensive side) | Hyperliquid funding feed | HL perps via CCTP |
| **Pythia** | News-reactive ETH/BTC perp trader | Twitter API + RSS via Nanopayments | HL perps via CCTP |
| **Demeter** | Stablecoin yield rotator | Arc on-chain yields | USDC ↔ USYC ↔ Aave/Morpho on Arc |

Every cycle (default 60s), each agent emits a proposal:

```json
{
  "agent_id": "pythia",
  "trade_idea": "long ETH-PERP 5x, target $XXXX, stop $YYYY",
  "reasoning_trace_cid": "ipfs://...",
  "reasoning_hash": "0x...",
  "confidence": 0.71,
  "requested_size_usd": 800,
  "timestamp": 1716422400
}
```

### F3 — Allocator service
- Off-chain Node service listening on each agent's proposal channel.
- Scoring function (v1) — two-phase, because we have ≤48 hours of history at launch:
  ```
  if trades_completed < 10:
    score = 0.6 * confidence + 0.4 * diversification_bonus    # bootstrap phase
  else:
    score = 0.5 * rolling_sharpe + 0.3 * confidence + 0.2 * diversification_bonus
  ```
  `rolling_sharpe` uses whatever window has data — initially 6h, grows toward 7d post-launch.
- Top-K (default K=2) proposals win allocation; others receive a 1% consolation budget so they keep iterating and building track record.
- Allocator calls `ThemisVault.allocate(agent, amount)` atomically.
- All allocation moves emit on-chain events for indexer.

### F4 — Reasoning trace publishing
- Every proposal serialized as JSON.
- Pinned to IPFS (Pinata) with Irys as fallback.
- `TraceAnchor.anchor(bytes32 hash, string memory cid)` writes the hash + CID on Arc as an event.
- Dashboard displays the hash with a clickable link to the full trace body on IPFS.

### F5 — Dashboard (Next.js web app)
- TVL counter, agent leaderboard, live PnL sparklines.
- Per-agent panel: current allocation %, 7-day Sharpe, drawdown, latest reasoning trace excerpt.
- Recent-decisions feed streaming new traces and trades.
- Deposit / withdraw via Circle App Kit Send component.
- Share-to-Twitter button on each notable decision (for traction loop).

## 6. Non-functional requirements

| | Requirement |
|---|---|
| **Latency** | Agent proposal → on-chain allocation confirmed ≤ 2s |
| **Reliability** | Vault state remains consistent if any single agent crashes |
| **Transparency** | All allocations, PnL, and traces queryable on-chain or via IPFS |
| **Safety** | Vault pausable by admin; per-agent daily loss cap of −5% allocation |
| **Cost** | All on-chain ops in USDC via Paymaster — no native gas token plumbing |

## 7. System architecture

```
┌──────────────────────────────────────────────────────────────┐
│                  Frontend (Next.js + wagmi)                   │
│   Dashboard · Deposit/Withdraw · Leaderboard · Trace Viewer   │
└──────────────────────────────────────────────────────────────┘
                              │
                ┌─────────────┴─────────────┐
                ▼                           ▼
┌─────────────────────────┐       ┌────────────────────────────┐
│   Vault Contract (Arc)  │◀──────│   Indexer (Node + SQLite)   │
│  · deposit / withdraw   │       │  Reads Arc events,          │
│  · allocate(agent, $)   │       │  serves REST + WebSocket    │
│  · settle(agent, pnl)   │       └────────────────────────────┘
│  pausable, capped       │                    ▲
└─────────────────────────┘                    │
                ▲                              │
                │                              │
   ┌────────────┴─────────────┐                │
   │   Allocator Service       │────────────────┘
   │  · ingests proposals      │
   │  · scores                 │
   │  · calls vault.allocate   │
   └──────────────────────────┘
                ▲
   ┌────────────┼────────────┐
   │            │            │
┌──┴───┐    ┌───┴──┐     ┌───┴────┐
│Hermes │   │Pythia │     │Demeter │  ← AI agent processes
└──────┘    └──────┘     └────────┘
   │            │            │
   │  Each pays Nanopayments │
   │  for data API calls     │
   ▼            ▼            ▼
[HL funding] [Twitter]   [On-chain yields]
```

### Smart contracts (Arc, EVM)
- `ThemisVault.sol` — ERC-4626-style USDC vault.
- `ThemisRegistry.sol` — agent registry + on-chain reputation counters.
- `TraceAnchor.sol` — single-function event emitter for reasoning traces.

### Off-chain services
- 3 agent processes (Node/TypeScript)
- 1 allocator process (Node/TypeScript)
- 1 indexer (Node + SQLite)
- 1 Next.js frontend

## 8. Key flows

### Flow 1 — Deposit
```
User → App Kit Send → ThemisVault.deposit(amount)
                   → mints shares to user
                   → emits Deposited event
                   → indexer picks up → dashboard updates
```

### Flow 2 — Agent decision cycle (every 60s, per agent)
```
1. Agent fetches data — pays per call via Gateway Nanopayments
2. LLM reasons → emits structured proposal
3. Trace JSON → IPFS pin → CID
4. Agent calls TraceAnchor.anchor(hash, cid)
5. Agent submits proposal to allocator over off-chain channel
6. Allocator scores all live proposals → calls ThemisVault.allocate(top_K)
7. Winning agent executes trade on its venue using allocated USDC
8. PnL settles → ThemisVault.settle(agent, pnl) → reputation updates
```

### Flow 3 — Withdrawal
```
User → ThemisVault.withdraw(shares)
     → contract computes current NAV
     → unwinds proportional allocations if needed
     → atomic USDC transfer back to user
```

## 9. Circle stack integration

| Tool | Where used |
|---|---|
| **Circle Wallets** | Sub-wallet per agent; admin wallet for allocator |
| **Paymaster** | Every tx pays gas in USDC — no native token sourcing |
| **Gateway Nanopayments** | Each agent's per-call data API spend (Twitter, sentiment, funding feeds) |
| **CCTP** | Move USDC to Hyperliquid Polygon collateral when Hermes/Pythia win allocation |
| **USYC** | Demeter's strategy: park unallocated capital for yield |
| **USDC / EURC** | All settlement |
| **App Kit (Send, Unified Balance)** | Frontend deposit / withdraw flows |

Seven Circle products, each load-bearing rather than ornamental.

## 10. 48-hour build schedule

### Day 1 — 2026-05-24

| Block | Deliverables |
|---|---|
| Morning | `ThemisVault.sol` deployed to Arc testnet (deposit/withdraw/allocate/settle); Circle Wallets sub-wallet setup for each agent |
| Afternoon | Hermes + Pythia scaffolds emitting mock proposals; allocator service ingesting and scoring |
| Evening | End-to-end deposit → score → allocate → settle cycle working in a script |

### Day 2 — 2026-05-25

| Block | Deliverables |
|---|---|
| Morning | Real trading wiring (Hyperliquid perp API for Hermes/Pythia; USYC/Aave wiring for Demeter); IPFS pinning live; `TraceAnchor` deployed |
| Afternoon | Frontend dashboard MVP (TVL, leaderboard, trace viewer); App Kit deposit/withdraw flows |
| Late afternoon | Real-money launch: onboard ≥5 depositors at $10–$50 each |
| Evening | Polish; record 3-minute demo video; submit by deadline |

## 11. Success metrics (for submission form's traction question)

| Metric | Target |
|---|---|
| TVL at submission | ≥ $300 USDC |
| Distinct depositor wallets | ≥ 5 |
| Reasoning traces published | ≥ 100 |
| Trades executed | ≥ 20 |
| PnL | Any — being live with real money is the win |

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Hyperliquid integration takes too long | Cut Hermes **and Pythia** (both depend on HL perps); ship with Demeter (yield rotator) + a stripped-down spot-only Pythia trading USDC/EURC on an Arc DEX |
| IPFS pinning unreliable | Fall back to Irys; if both fail, anchor only the hash (no body) |
| Real depositors lose money → reputational risk | Cap deposits at $100/wallet, $5k total; pause if -10% drawdown |
| Allocator is single point of failure | Acceptable for v1; supervised restart on crash |
| LLM hallucinates → dumb trade | Per-agent daily loss cap (-5%); sidelined for the rest of the day if breached |
| Real-money custody risk in a hackathon-grade contract | Multi-sig admin pause; treat as alpha; banner in UI reads *"Hackathon prototype — unaudited — deposits capped at $100"*; not advertised as a production product |

## 13. Open questions

1. Which Hyperliquid bridge route is most reliable from Arc via CCTP? Need a Day-1 spike.
2. Allocator: pure off-chain service vs. on-chain sealed-bid auction? **v1 = off-chain service.**
3. Agent reputation: stored on `ThemisRegistry` contract or just in indexer DB? **v1 = both — minimal counters on-chain, rich history in indexer.**
4. Should depositors vote on which agents are active in the pool? **Post-hackathon.**

## 14. Demo script (3-minute video target)

| 0:00–0:20 | The pitch. "An agora of AI agents bidding for the right to trade real USDC, live on Arc." |
| 0:20–0:50 | Open dashboard. TVL counter ticking. Three named agents on the leaderboard with live PnL. |
| 0:50–1:30 | A news event drops in the data feed. **Pythia** spikes confidence → wins allocation in ~350ms → trade executes → reasoning trace appears with clickable IPFS link. |
| 1:30–2:00 | Cut to **Hermes** quietly compounding from funding-rate arb; its capital share grows. Meanwhile **Demeter** rotated unallocated capital into USYC — yield ticking visibly. |
| 2:00–2:30 | Show real depositor wallets and TVL growth chart from the hackathon window. |
| 2:30–3:00 | Punchline: *"Three minds, one wallet, no humans — and it's still up. The agora trades itself."* GitHub + live link. |

---

**End of PRD v1.**
