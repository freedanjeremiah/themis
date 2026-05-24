# Phase 3 — Onboarding + Reasoning Theater UX Design

**Date:** 2026-05-24
**Author:** Romario Kavin (with Claude Code)
**Status:** Design approved, awaiting plan
**Depends on:** Phase 1 (vault custody) + Phase 2 (real PnL) merged to main.

## Context

After Phase 2 the system tells the truth — every PnL value on the dashboard maps to a real on-chain event. But the existing dashboard is a developer surface: dense agent leaderboard table on top, a compact `TracesFeed` underneath, a small `DepositPanel` sidebar. A first-time visitor from a tweet has no idea what to look at first, no path to participate, and the agent reasoning — Themis's actual differentiator — is buried in a sub-section.

Phase 3 reshapes the dashboard for a casual visitor. Two pillars:
1. **Frictionless onboarding** — a top-of-page strip walks a brand-new visitor from wallet connect → Arc-testnet add → testnet USDC → first deposit in under 90 seconds. Strip vanishes once they've deposited.
2. **Reasoning theater** — the live agent decisions become the centerpiece. Big trace cards in the main column with prominent `trade_idea` text, an animated confidence bar, and a `Why?` expandable that fetches the full reasoning trace from IPFS. Leaderboard demoted to a compact sidebar list.

Mobile responsiveness, social OG cards, status pages, and a separate "how it works" route are deferred to Phase 5+.

## Scope decisions

| Question | Decision |
|---|---|
| Layout | **Theater hero (left 2/3), leaderboard + deposit stacked sidebar (right 1/3), activity ticker fixed bottom bar.** |
| Faucet URL | Env-configurable via `NEXT_PUBLIC_FAUCET_URL` (default `https://faucet.arc.network` — operator overrides if Arc publishes a canonical testnet faucet). |
| Onboarding visibility | Visible until the connected wallet has made ≥1 deposit OR user manually dismisses. Progress tracked in `localStorage` to survive refreshes. |
| Reasoning fetch | Multi-gateway IPFS fallback (Pinata → ipfs.io → cf-ipfs); React Query with in-memory cache; lazy — only fetched when user clicks `Why?`. |
| Agent tooltips | Defined inline in a single `AGENT_META` constant. No CMS, no docs page. |
| Mobile | Out of scope. Desktop ≥1024px only. |
| Trust/social pages | Out of scope. Only an inline "What is this?" tooltip on the title. |
| Live activity ticker | Fixed-position thin bottom bar. Last 8 events visible at any time; older fade out. |

## Target architecture changes

### Layout

```
┌─────────────────────────────────────────┐
│  TVL: $XXX.XX (depositor count)         │
└─────────────────────────────────────────┘
┌──── Onboarding strip (hidden after first deposit) ────┐
│  1. Connect wallet → 2. Add Arc testnet → 3. Get USDC → 4. Deposit │
└─────────────────────────────────────────────────────────┘
┌────────────────────────────┬─────────────┐
│  REASONING THEATER (2/3)   │ Leaderboard │
│  • Big trace cards         │ (compact)   │
│  • Confidence bar          │             │
│  • Why? → IPFS trace       ├─────────────┤
│  • Auto-stream on WS       │ DepositPanel│
└────────────────────────────┴─────────────┘
┌── Live activity ticker (fixed bottom bar) ──┐
│ → Pythia closed ETH +$2.30 · 14s ago        │
└──────────────────────────────────────────────┘
```

Layout containers stretch to a max width of `5xl` (1024px) — same as today.

### New components

| Path | Responsibility |
|---|---|
| `apps/dashboard/src/components/OnboardingStrip.tsx` | The top onboarding flow. Reads connected wallet via wagmi, computes current step (0-4), shows the next action button. Hides itself when step 4 complete OR user dismisses. |
| `apps/dashboard/src/components/ReasoningTheater.tsx` | The hero panel. Renders trace cards from the existing trace stream. Each card has agent badge, large `tradeIdea`, animated confidence bar, `Why?` expandable. |
| `apps/dashboard/src/components/TraceCard.tsx` | Single trace card. Used inside `ReasoningTheater`. |
| `apps/dashboard/src/components/WhyExpandable.tsx` | The "Why?" disclosure region. Uses `useTrace(cid)` hook to lazy-fetch IPFS content. |
| `apps/dashboard/src/components/CompactLeaderboard.tsx` | Sidebar-sized leaderboard. Replaces the wide `AgentLeaderboard` in the new layout (the wide version stays exported but is no longer rendered on the homepage). |
| `apps/dashboard/src/components/ActivityTicker.tsx` | Fixed bottom bar. Subscribes to the same WS stream, formats events into one-line summaries. |
| `apps/dashboard/src/components/AgentBadge.tsx` | Reusable badge with agent name + colour + hover tooltip (uses `AGENT_META`). |
| `apps/dashboard/src/components/WsStatusIndicator.tsx` | Tiny dot in the page header that shows green when WS connected, amber when reconnecting, red when down for >10s. |
| `apps/dashboard/src/components/DisclaimerBanner.tsx` | Persistent slim banner at very top: "Arc testnet — testnet USDC only — not real money." Dismissable; dismissal stored in localStorage. |
| `apps/dashboard/src/hooks/useTrace.ts` | `(cid: string) => { data, isLoading, error }`. React Query under the hood; multi-gateway IPFS fallback; in-memory cache. |
| `apps/dashboard/src/hooks/useOnboardingStep.ts` | Returns `{ step: 0 \| 1 \| 2 \| 3 \| 4, advance, dismiss, dismissed }`. Reads wagmi `isConnected`, `chainId`, USDC balance, and deposit history. |
| `apps/dashboard/src/lib/agent-meta.ts` | `AGENT_META: Record<AgentId, { name, color, thesis, venue }>`. Single source of truth for agent display info. |
| `apps/dashboard/src/lib/ipfs.ts` | `fetchTrace(cid)` with gateway fallback. |

### Modified components

| Path | Change |
|---|---|
| `apps/dashboard/src/app/page.tsx` | Use the new layout. Compose `DisclaimerBanner`, `TvlBar`, `OnboardingStrip`, `ReasoningTheater`, `CompactLeaderboard`, `DepositPanel`, `ActivityTicker`. Remove the wide `AgentLeaderboard` + small `TracesFeed` rendering. |
| `apps/dashboard/src/app/layout.tsx` | Add a `<div className="pb-12">` wrapper (or equivalent) so the fixed bottom ticker doesn't cover content. |
| `apps/dashboard/src/hooks/useIndexerSocket.ts` | Expose a `connectionState: "connecting" \| "open" \| "closed"` value so `WsStatusIndicator` and `ReasoningTheater` can react to drops. |
| `apps/dashboard/src/components/TracesFeed.tsx` | Deleted; superseded by `ReasoningTheater` + `TraceCard`. |
| `apps/dashboard/src/components/AgentLeaderboard.tsx` | Kept (it still serves a debug surface) but no longer rendered on the home page. |
| `apps/dashboard/src/components/Providers.tsx` | Wrap children with `QueryClientProvider` (React Query) so `useTrace` works. React Query already a transitive dep of wagmi v2. |
| `apps/dashboard/package.json` | Add `@tanstack/react-query` directly as a dep (it is currently transitive; making it direct ensures version stability). |

### Data flow

1. WS subscription (`useIndexerSocket`) feeds three shared consumers in `page.tsx`: `ReasoningTheater` (filters `event === "trace"`), `CompactLeaderboard` (filters `event === "allocation" | "settlement"`), `ActivityTicker` (consumes all events).
2. `OnboardingStrip` reads wagmi state (`useAccount`, `useChainId`, USDC `balanceOf`) and the deposit history (`vault.depositedBy(address)`) via wagmi `useReadContract`. Step transitions are derived, not stored — only the "dismissed" flag persists in localStorage.
3. `WhyExpandable` calls `useTrace(cid)` only on user click. The hook:
   - converts `ipfs://Qm...` → `https://<gateway>/ipfs/Qm...` for each of three gateways
   - races them with `Promise.any`; first 200 wins
   - caches the resolved JSON by CID in React Query (`staleTime: Infinity`)
4. `ActivityTicker` keeps a sliding window of the last 8 events in component state. New events push, oldest fades out via CSS opacity transition.

### Onboarding state machine

```
Step 0  No wallet connected            → button: "Connect Wallet" (opens wagmi connector)
Step 1  Connected, wrong chain          → button: "Add Arc Testnet" (calls wallet_addEthereumChain)
Step 2  Right chain, USDC balance < $10 → button: "Get testnet USDC" (opens NEXT_PUBLIC_FAUCET_URL + copy address)
Step 3  Has USDC, no deposits           → button: "Deposit $10" (pre-fills amount, opens DepositPanel focus)
Step 4  Has ≥1 deposit                  → strip hides itself
```

The user can dismiss the strip at any step via an `×` in the corner. Dismissal persists per-browser. A subtle "show onboarding" link reappears in the page footer if dismissed.

### Honest disclaimers

- `DisclaimerBanner` at the very top: `Arc testnet — testnet USDC only — not real money. Hackathon prototype, unaudited.` Dismissable.
- The existing `TvlBar` already has a yellow "Hackathon prototype" caution. Keep it but trim text since the banner already says the same.
- Remove any remaining "Powered by Circle App Kit" or "App Kit Send" claim — only attribute Circle for what we actually use (Developer-Controlled Wallets for the agents, CCTP for bridging).

### Agent narratives

```typescript
// apps/dashboard/src/lib/agent-meta.ts
export const AGENT_META = {
  hermes: {
    name: "Hermes",
    color: "blue",
    thesis: "Funding-rate arbitrage — longs the cheap side and shorts the expensive side of perpetual funding rates.",
    venue: "Hyperliquid testnet (via CCTP)",
  },
  pythia: {
    name: "Pythia",
    color: "purple",
    thesis: "News-reactive ETH/BTC perp trader. Reads Twitter + RSS, asks Claude what to do, trades the sentiment.",
    venue: "Hyperliquid testnet (via CCTP)",
  },
  demeter: {
    name: "Demeter",
    color: "green",
    thesis: "Stablecoin yield rotator. Parks idle capital in USYC for yield while perp agents trade.",
    venue: "USYC Teller on Arc",
  },
} as const;
```

`AgentBadge` reads from this constant. Hovering shows a tooltip with `thesis` + `venue`.

### Live activity ticker rules

- Events shown: deposit, allocation, settlement, trace.
- Format: agent + verb + value/idea + relative time. e.g.
  - `Pythia opened ETH-PERP long · 3s ago`
  - `Hermes settled +$2.30 · 14s ago`
  - `Demeter rotated $25 → USYC · 28s ago`
  - `New depositor: 0xAb..3F · $10 deposited · 1m ago`
- Sliding window of last 8; oldest fades out via CSS opacity over ~1s when a new event arrives.

### Empty + loading + error states

- **Empty trace stream** (page first loads, no events yet): `ReasoningTheater` shows three skeleton cards (one per agent) with "Waiting for first decision…" subtext.
- **Empty TVL** (no deposits ever): `TvlBar` shows `$0.00` and the disclaimer banner remains.
- **WS dropped >10s**: `WsStatusIndicator` turns red; theater cards continue showing the last batch but with a subtle "Live updates paused" pill at the top.
- **IPFS fetch fails** (all 3 gateways): `WhyExpandable` shows `Trace unavailable — try refreshing.`
- **No wallet** (visitor never connects): everything still works in read-only mode; onboarding strip prompts to connect; deposit panel disabled.

## Files this phase touches

```
apps/dashboard/src/app/page.tsx                          new layout
apps/dashboard/src/app/layout.tsx                        bottom padding for ticker
apps/dashboard/src/components/OnboardingStrip.tsx        NEW
apps/dashboard/src/components/ReasoningTheater.tsx       NEW
apps/dashboard/src/components/TraceCard.tsx              NEW
apps/dashboard/src/components/WhyExpandable.tsx          NEW
apps/dashboard/src/components/CompactLeaderboard.tsx     NEW
apps/dashboard/src/components/ActivityTicker.tsx         NEW
apps/dashboard/src/components/AgentBadge.tsx             NEW
apps/dashboard/src/components/WsStatusIndicator.tsx      NEW
apps/dashboard/src/components/DisclaimerBanner.tsx       NEW
apps/dashboard/src/components/Providers.tsx              + QueryClientProvider
apps/dashboard/src/components/TracesFeed.tsx             DELETE
apps/dashboard/src/hooks/useTrace.ts                     NEW
apps/dashboard/src/hooks/useOnboardingStep.ts            NEW
apps/dashboard/src/hooks/useIndexerSocket.ts             + connectionState export
apps/dashboard/src/lib/agent-meta.ts                     NEW
apps/dashboard/src/lib/ipfs.ts                           NEW
apps/dashboard/package.json                              + @tanstack/react-query (direct dep)
.env.example                                             + NEXT_PUBLIC_FAUCET_URL
```

## Out of scope (deferred to Phase 4/5)

- Mobile-responsive layout.
- Per-trace social OG card image generation.
- Standalone "How Themis works" route.
- Public status page.
- Dark/light mode toggle (dark stays).
- Internationalisation.
- Analytics/telemetry of visitor behaviour.

## Definition of done

A 60-second screen recording: brand-new visitor lands on `/`, sees the disclaimer banner + onboarding strip, clicks through Connect → Add Arc → Get USDC → Deposit $10 in under 90 seconds. The reasoning theater visibly streams at least one new trace during the recording. No console errors. WS status indicator stays green. The activity ticker shows at least one ticker event flow in.

## Open risks

1. **Arc testnet faucet availability.** If Arc has no public faucet, `NEXT_PUBLIC_FAUCET_URL` points to a doc page explaining how to request USDC via Discord. Acceptable for hackathon scope.
2. **IPFS gateway flakiness.** Pinata gateway may rate-limit; the multi-gateway fallback mitigates. If all three are down, `WhyExpandable` shows the error state; the rest of the page remains usable.
3. **WS reconnect storms.** If the indexer restarts during a demo, all clients reconnect simultaneously. The existing exponential-backoff hook handles this — no new work needed.
4. **localStorage privacy mode.** Safari Private Browsing throws on `localStorage.setItem`. Wrap calls in `try/catch`; onboarding strip will then re-appear each refresh in private mode (acceptable).
5. **Onboarding step transitions race wagmi state.** `useOnboardingStep` should debounce ~250ms so a freshly-connected wallet doesn't flash through steps 1→2→3 before settling. Plan task includes this.
