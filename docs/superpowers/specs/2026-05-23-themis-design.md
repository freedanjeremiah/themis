# Themis — Technical Design Spec

| | |
|---|---|
| **Date** | 2026-05-23 |
| **PRD** | `2026-05-23-themis-prd.md` |
| **Deadline** | 2026-05-25 |
| **Status** | Approved — ready for implementation planning |

---

## 1. Repo structure

pnpm monorepo. One `pnpm dev` command starts all services. Shared TypeScript types in `packages/shared` eliminate API contract drift between agents, allocator, and indexer.

```
themis/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── packages/
│   └── shared/
│       ├── types.ts          # AgentProposal, AllocationResult, TraceRecord, AgentState
│       └── abis/             # generated JSON ABIs from contracts build
└── apps/
    ├── contracts/            # Hardhat project
    │   └── contracts/
    │       ├── ThemisVault.sol
    │       ├── ThemisRegistry.sol
    │       └── TraceAnchor.sol
    ├── agent-hermes/         # Funding-rate arb (Node/TS)
    ├── agent-pythia/         # News-reactive (Node/TS)
    ├── agent-demeter/        # Yield rotator (Node/TS)
    ├── allocator/            # Scoring + vault calls (Node/TS)
    ├── indexer/              # Arc event reader + REST/WS (Node/TS + SQLite)
    └── dashboard/            # Next.js 14 app router
```

---

## 2. Shared types (`packages/shared/types.ts`)

```typescript
type AgentId = "hermes" | "pythia" | "demeter";

type AgentProposal = {
  agentId: AgentId;
  tradeIdea: string;           // one-line human-readable summary (shown on dashboard)
  action: "long" | "short" | "rotate" | "hold";
  venue: "hyperliquid" | "arc-dex" | "usyc" | "aave";
  requestedSizeUsd: number;    // in whole USDC
  confidence: number;          // 0–1
  reasoningTraceCid: string;   // ipfs://...
  reasoningHash: string;       // 0x keccak256 of trace JSON
  timestamp: number;           // unix seconds
};

type AllocationResult = {
  cycleId: number;
  winners: { agentId: AgentId; allocatedUsd: number }[];
  losers:  { agentId: AgentId; allocatedUsd: number }[];  // consolation 1%
  timestamp: number;
};

type TraceRecord = {
  agentId: AgentId;
  cid: string;
  hash: string;
  tradeIdea: string;
  confidence: number;
  blockTime: number;
};

type AgentState = {
  agentId: AgentId;
  tradesCompleted: number;
  currentAllocationUsd: number;
  cumulativePnlToday: number;
  pnlHistory: { timestamp: number; pnl: number }[];  // for rolling Sharpe
  sidelined: boolean;
};
```

---

## 3. Smart contracts

### 3.1 `ThemisVault.sol`

ERC-4626-style USDC vault. The reserve buffer, deposit caps, and safety mechanisms are enforced at the contract level — not just in off-chain services.

**Key state:**

```solidity
IERC20 public usdc;
address public allocator;
address public admin;

uint256 public constant RESERVE_BPS = 2000;   // 20% always liquid
uint256 public constant WALLET_CAP  = 100e6;  // $100 USDC per wallet
uint256 public constant VAULT_CAP   = 5000e6; // $5,000 USDC total
uint256 public totalAssets;                   // tracks NAV (updated on settle)
bool    public paused;

mapping(address => uint256) public agentAllocation;  // agent → USDC deployed
mapping(address => uint256) public depositedBy;      // wallet → USDC deposited
mapping(address => bool)    public agentSidelined;
mapping(address => int256)  public agentDailyPnl;    // resets each UTC day
```

**External functions:**

```solidity
function deposit(uint256 amount) external notPaused
function withdraw(uint256 shares) external notPaused
function allocate(address agent, uint256 amount) external onlyAllocator notPaused
function settle(address agent, int256 pnl) external onlyAllocator
function sidelineAgent(address agent) external onlyAllocator
function pause() external onlyAdmin
function unpause() external onlyAdmin
```

**Withdrawal invariant:** `withdraw` draws only from the liquid reserve (`totalAssets - sum(agentAllocations)`). If `shares × sharePrice > liquidReserve`, the call reverts with `InsufficientLiquidity(uint256 available, uint256 requested)`. The 20% reserve makes this rare at hackathon TVL.

**`settle` safety:** after updating `agentDailyPnl`, if `agentDailyPnl[agent] < -5% of agentAllocation[agent]`, emit `AgentSidelined(agent)` and zero the allocation. The allocator checks this flag before scoring next cycle.

**Events:**

```solidity
event Deposited(address indexed wallet, uint256 amount, uint256 shares);
event Withdrawn(address indexed wallet, uint256 shares, uint256 amount);
event Allocated(address indexed agent, uint256 amount, uint256 cycleId);
event Settled(address indexed agent, int256 pnl, uint256 totalAssets);
event AgentSidelined(address indexed agent, int256 dailyPnl);
```

---

### 3.2 `ThemisRegistry.sol`

On-chain reputation counters. Minimal — rich history lives in the indexer.

```solidity
struct AgentStats {
  uint64  tradesWon;
  uint64  tradesLost;
  int128  cumulativePnlUsdc;   // 1e6 units
  bool    active;
}
mapping(address => AgentStats) public stats;

function registerAgent(address agent) external onlyAdmin;
function recordOutcome(address agent, bool won, int128 pnl) external onlyAllocator;
```

---

### 3.3 `TraceAnchor.sol`

Single-function event emitter. No storage — the hash+CID pair is permanently queryable from Arc's event log.

```solidity
event TraceAnchored(
  address indexed agent,
  bytes32         hash,
  string          cid,
  uint256         timestamp
);

function anchor(address agent, bytes32 hash, string calldata cid) external {
  emit TraceAnchored(agent, hash, cid, block.timestamp);
}
```

No access control — the `agent` address in the event is the authenticity signal.

---

## 4. Agent architecture

All three agents share the same runtime loop. Only `data.ts` (inputs) and the Claude system prompt differ.

### 4.1 Shared loop (every 60s)

```
data.ts    → fetch external market data
reason.ts  → Claude API call → structured AgentProposal JSON
anchor.ts  → pin trace JSON to IPFS (Pinata; Irys fallback)
           → call TraceAnchor.anchor(hash, cid) on Arc
propose.ts → HTTP POST AgentProposal to allocator /proposals
```

On any step failure: log error, skip cycle, retry next cycle. A crashed agent never affects vault state.

### 4.2 Claude prompt structure

```
System: You are [Hermes|Pythia|Demeter], a specialized trading agent on Themis.
        Output must be valid JSON matching AgentProposal schema exactly.
        Reason step-by-step before concluding. Be explicit about why.
        If uncertain, express that in the confidence field (lower = less certain).

User:   Current market data:
        [injected raw data]

        Current vault state:
        [injected from allocator /state]

        Produce a trade proposal.
```

The full Claude response (all tokens including chain-of-thought) is the trace JSON pinned to IPFS. The `tradeIdea` field is the one-line summary shown in the dashboard. If Claude returns malformed JSON, the agent retries once with `"your previous output was not valid JSON — try again"` appended; if still invalid, the cycle is skipped.

### 4.3 Per-agent specifics

**Hermes — Funding-rate arb**
- Data: Hyperliquid public funding rate API (no Nanopayments needed)
- Strategy: compare rates across perp markets; long the cheap side, short the expensive side
- Execution: CCTP bridges USDC from Arc to Hyperliquid as perp collateral

**Pythia — News-reactive**
- Data: recent crypto Twitter + RSS headlines via Gateway Nanopayments (pay-per-call)
- Strategy: Claude assesses directional sentiment for BTC/ETH; emits long/short perp proposal with explicit headline citations
- Execution: CCTP → Hyperliquid perps
- Highest demo narrative value (news event triggers visible confidence spike)

**Demeter — Yield rotator**
- Data: Arc on-chain yield rates (USYC APY, Aave/Morpho supply rates) via RPC — no external API
- Strategy: Claude picks highest-yield venue for idle USDC
- Execution: USDC → USYC swap or Aave supply tx, directly on Arc
- Lowest risk; always earns something; good visual contrast to the perp traders

---

## 5. Allocator service

### 5.1 HTTP API (localhost only)

```
POST /proposals    ← agents POST AgentProposal (schema-validated; drops malformed)
GET  /state        ← indexer + allocator crash-recovery endpoint
```

### 5.2 Allocation cycle (every 60s, fires 5s after agents)

```
1. Collect all proposals received in the last window
2. Apply stale proposal guard: drop any with timestamp < now - 90s
3. Score each non-sidelined proposal
4. Pick top-K (K=2) winners by score
5. Apply reserve guard: scale winner sizes down if needed to maintain 20% reserve
6. Call ThemisVault.allocate(agent, amount) for each winner (multicall if possible)
7. Call ThemisVault.allocate(agent, 1% of requested) for each non-winner (consolation)
8. Push AllocationResult via WebSocket to indexer
9. Trigger each winning agent's execute() — agent places the actual trade
10. After trade settles: call ThemisVault.settle(agent, realizedPnl)
11. Call ThemisRegistry.recordOutcome(agent, won, pnl)
```

### 5.3 Scoring formula

```typescript
function score(agent: AgentState, proposal: AgentProposal): number {
  const diversificationBonus = isLeastAllocatedVenue(proposal.venue) ? 0.1 : 0;

  if (agent.tradesCompleted < 10) {
    // bootstrap phase — no reliable Sharpe yet
    return 0.6 * proposal.confidence + 0.4 * diversificationBonus;
  }

  const sharpe = computeRollingSharpe(agent); // uses all available history, min 6h window
  return 0.5 * sharpe + 0.3 * proposal.confidence + 0.2 * diversificationBonus;
}
```

### 5.4 In-memory `AgentState`

Held in memory; rebuilt from indexer `/state` on crash + restart. No separate database needed for the allocator.

### 5.5 Safety checks (before calling vault)

| Check | Action if triggered |
|---|---|
| `agentSidelined[agent] == true` | Skip agent entirely this cycle |
| `agentDailyPnl < -5% of allocation` | Skip; vault's `settle()` will sideline on-chain |
| `proposal.timestamp < now - 90s` | Drop stale proposal |
| Reserve would drop below 20% after allocation | Scale all winner sizes proportionally |

---

## 6. Indexer

Node/TypeScript + SQLite. Two jobs: poll Arc for events and insert rows; serve REST + WebSocket to the dashboard.

### 6.1 SQLite schema

```sql
CREATE TABLE deposits (
  id INTEGER PRIMARY KEY,
  wallet TEXT, amount_usdc INTEGER, shares INTEGER, tx_hash TEXT, block_time INTEGER
);
CREATE TABLE allocations (
  id INTEGER PRIMARY KEY,
  agent_id TEXT, amount_usdc INTEGER, cycle_id INTEGER, tx_hash TEXT, block_time INTEGER
);
CREATE TABLE settlements (
  id INTEGER PRIMARY KEY,
  agent_id TEXT, pnl_usdc INTEGER, total_assets INTEGER, tx_hash TEXT, block_time INTEGER
);
CREATE TABLE traces (
  id INTEGER PRIMARY KEY,
  agent_id TEXT, cid TEXT, hash TEXT, trade_idea TEXT, confidence REAL, block_time INTEGER
);
```

### 6.2 Event polling

`ethers` provider polls Arc every 2s for `Deposited`, `Allocated`, `Settled`, and `TraceAnchored` events. On each event: insert row + push WebSocket message to all connected clients.

### 6.3 REST endpoints

```
GET /tvl          → { totalUsdc, sharePrice, depositCount }
GET /agents       → AgentSummary[] (allocation%, 7d sharpe, drawdown, lastTrace)
GET /traces       → TraceRecord[] (latest 20, paginated)
GET /state        → full agent state for allocator crash recovery
```

### 6.4 WebSocket

Single channel. Pushes `{ event: "allocation" | "trace" | "deposit" | "settlement", data }` on every new row. Dashboard subscribes on mount.

---

## 7. Dashboard

Next.js 14 app router. Four panels, all driven by the indexer WebSocket.

### 7.1 TVL bar

Live USDC counter at the top of the page. Ticks up on every `deposit` event. Share price shown alongside. Animated counter using `react-countup`.

### 7.2 Agent leaderboard

Three rows (Hermes, Pythia, Demeter), each showing:
- Current allocation %
- 7-day Sharpe (or "Bootstrap" badge if < 10 trades)
- Max drawdown
- PnL sparkline (recharts, last 24 data points)
- "View last trace" button → opens trace modal with full IPFS link

Rows re-sort by current score on every allocation cycle.

### 7.3 Recent decisions feed

Scrolling list of the last 20 traces. Each entry: agent name + color badge, one-line `tradeIdea`, confidence meter, timestamp, clickable IPFS link.

"Share to Twitter" button on each entry constructs a pre-filled tweet:
```
[Pythia] just went long ETH-PERP 5x with 71% confidence on Themis.
Reasoning: ipfs://... #AgoraAgents #Arc
```

### 7.4 Deposit / Withdraw panel

Circle App Kit `Send` component wired to `ThemisVault.deposit()` and `withdraw()`. Displays:
- Current wallet cap remaining ($100 − deposited)
- Current liquid reserve % (so users understand withdrawal limits)
- Prominent warning banner: *"Hackathon prototype — unaudited — deposits capped at $100"*

---

## 8. Error handling

| Failure | Behavior |
|---|---|
| Agent process crashes | Allocator skips it this cycle; other agents compete normally |
| Allocator crashes | Vault state unchanged; agents queue proposals; allocator rebuilds from indexer `/state` on restart |
| IPFS pin fails (Pinata) | Retry with Irys; if both fail, anchor only the hash — trace body missing but hash on-chain |
| Withdrawal > liquid reserve | Vault reverts `InsufficientLiquidity`; dashboard shows friendly message with available amount |
| Agent breaches daily −5% loss | Allocator skips; vault `settle()` calls `sidelineAgent` on-chain; dashboard shows "Sidelined" badge |
| Claude returns malformed JSON | Retry once with correction prompt; if still invalid, skip cycle |
| Hyperliquid/CCTP integration fails on Day 1 | Fall back to Demeter-only + spot-only Pythia on an Arc DEX (per PRD risk mitigation) |

---

## 9. Testing approach

Given the 48-hour window, tests focus on the highest-risk paths only.

**Contracts:** Hardhat tests for `ThemisVault` — deposit/withdraw round-trip, reserve enforcement, daily loss cap triggering `sidelineAgent`, NAV calculation after positive and negative PnL settlement.

**Allocator:** Unit tests for the scoring formula (bootstrap vs. post-10-trades), the stale proposal guard, and the reserve scaling logic.

**Agents:** Manual smoke test — run each agent against mock data, verify Claude output parses to a valid `AgentProposal`.

**End-to-end:** A single integration script (`scripts/e2e.ts`) that runs a full cycle: mock deposit → 3 agent proposals → allocator scores + calls vault → settle → verify indexer picks up all events.

---

## 10. Key decisions record

| Decision | Choice | Reason |
|---|---|---|
| Agent → allocator IPC | HTTP POST | Simplest; no extra infra; well under 2s latency |
| LLM | Claude (Anthropic API) | Strong structured output, instruction-following for JSON traces |
| Withdrawal model | 20% liquid reserve buffer | Atomic, honest, no state machine complexity |
| Repo structure | pnpm monorepo | Shared types, one-command startup, fast for 48h |
| Allocator persistence | In-memory + indexer crash recovery | No extra DB; indexer is already the durable store |
| On-chain reputation | Minimal counters (`ThemisRegistry`) + rich history in indexer | Best of both: verifiable on-chain, queryable off-chain |

---

**End of design spec.**
