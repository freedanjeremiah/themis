# Circle / Arc — Builder Feedback (Themis, Agora Hackathon 2026)

> Specific, actionable feedback gathered while building Themis — a multi-agent
> on-chain hedge fund — on Arc testnet during the Agora hackathon.
> Integration surface: ThemisVault + ThemisRegistry (Solidity 0.8.24),
> an ethers v6 event indexer, three AI trading agents, and a Next.js/wagmi v2
> dashboard — all settling in USDC on Arc testnet (chainId 5042002).

---

## 1. What worked well

**USDC as the native gas token is genuinely elegant.**
Removing the Paymaster dance means a vault contract can custody the gas token
directly, agent wallets top up once and run autonomously, and the accounting
story for depositors is clean: one token, one mental model. This is the right
design and it showed during the build.

**Testnet throughput was sufficient for tight agent cycles.**
20-minute cycles with three concurrent agents + an allocator making on-chain
`allocate` / `settle` calls ran without congestion. Block time felt consistent
enough to write reliable `waitForTransactionReceipt` flows.

**CCTP V2 exists when you need cross-chain liquidity.**
Having a credible Arc → HyperEVM bridge path (even if we ultimately replaced it
with pre-funded wallets under deadline pressure) meant the architecture could
be designed correctly from the start.

---

## 2. Reproducible bugs / sharp edges

### 2.1 `eth_newFilter` subscriptions silently stop after RPC reconnect

**Observed.** `eth_newFilter`-based subscriptions (`contract.on(...)` in
ethers v6) return a `filterId` that the Arc testnet RPC does not persist across
reconnects. After any reconnect, every subsequent `eth_getFilterChanges` call
returns `filter not found`. Events stop arriving with no error surface to the
application — the listener appears alive but delivers nothing.

**Impact.** Our indexer missed `Deposited`, `Allocated`, and `Settled` events
silently until we noticed the dashboard going stale. We rewrote the entire
listener layer to poll `eth_getLogs` with manual block-range chunking.

**Ask.** Either persist filter state across RPC sessions, or return a clear
error on `eth_getFilterChanges` for an expired filter so clients can
re-subscribe. At minimum, document this loudly in the testnet RPC reference.

### 2.2 `eth_getLogs` has an undocumented block-range cap (~10 k blocks)

**Observed.** `eth_getLogs` requests spanning more than roughly 10 000 blocks
return an opaque error (no standard error code, no mention of the limit in the
message). We discovered the cap empirically and now chunk all log queries at
9 000 blocks with a manual loop.

**Ask.** Document the exact block-range limit. Ideally surface it in the error
body: `{ "code": -32005, "message": "block range exceeds 10000" }` (the
Ethereum standard for this case). Without the number in the error, every team
discovers it independently.

### 2.3 USYC Teller reverts with an unknown custom error on testnet

**Observed.** `teller.deposit(...)` on the USYC Teller contract reverts with
an undecoded custom error — appears to be a KYC / allow-list gate that is
active on testnet with no open path around it.

**Impact.** The stablecoin yield-rotation use case (one of Arc's headline
stories) is effectively blocked on testnet. We fell back to a simulated yield
model (5.2% APY, computed off-chain) just to keep the agent running.

**Ask.** Either open a testnet allow-list path (e.g. auto-approve any address
that requests it via a faucet-style endpoint), or surface a human-readable
revert reason so integrators know immediately what gate they are hitting and
how to request access.

---

## 3. Documentation gaps

### 3.1 No "configuring viem / wagmi / ethers for Arc" guide

USDC-as-native-gas breaks a widespread tooling assumption: most libraries,
type definitions, and UI components treat the native currency as 18-decimal
ETH. On Arc, `chain.nativeCurrency` must be declared as USDC (6 decimals,
`0x3600000000000000000000000000000000000000`). Without documentation, teams
hit silent display bugs (balances shown as `0.000010` instead of `10.00`),
incorrect gas estimation, and wallet-connect UI showing the wrong symbol.

A single "Arc chain object for viem/wagmi/ethers" snippet in the docs would
save every team the same 2–3 hours of debugging.

### 3.2 No block explorer / no tx-status endpoint during the hackathon

With no working explorer on Arc testnet, verifying whether a transaction
landed, inspecting revert reasons, and checking contract state during
development required writing bespoke scripts against the RPC. This significantly
slowed the contract debugging loop — especially for custom Solidity errors,
where the ABI is needed to decode the revert.

**Ask.** A hosted explorer (even a minimal one — tx hash → status + logs) or
a `debug_traceTransaction` endpoint. Either meaningfully accelerates builder
iteration speed.

### 3.3 No canonical faucet URL

There is no single, discoverable faucet for Arc testnet USDC. We found the
Circle generic faucet independently and linked to it from our dashboard. A
pinned link in the Discord + developer docs would save every hackathon team
this search, and is especially important for judges trying to replicate a demo.

### 3.4 Deployed protocol inventory

We discovered late that Aave v3 is not deployed on Arc testnet — after
building integration code for it. A short "what's deployed on testnet" table
(protocol → contract address or "not available") in the docs would let teams
scope correctly from the start.

---

## 4. Feature requests

| # | Feature | Why |
|---|---|---|
| 1 | **Persistent `eth_newFilter` across reconnects** | Without this, all event-driven indexers are broken on Arc testnet. Poll-getLogs workarounds add significant complexity. |
| 2 | **Documented `eth_getLogs` block-range limit with structured error** | Every team discovers this empirically. Structured error + docs would eliminate the surprise. |
| 3 | **Open USYC Teller testnet path** | Stablecoin yield rotation is an Arc flagship use case. A KYC-gated testnet contract blocks it for every builder. |
| 4 | **"Arc chain config" snippet for viem / wagmi / ethers in docs** | USDC-as-native-gas is novel; the config is non-obvious; the failure mode is silent. One code block fixes it permanently. |
| 5 | **Hosted block explorer or `debug_traceTransaction`** | Contract debugging without an explorer is painful. Even a minimal tx-hash → receipt + decoded logs page would help significantly. |
| 6 | **Canonical testnet faucet with a stable URL** | Required for judges replicating demos and for onboarding new team members mid-hackathon. |
| 7 | **Deployed protocol registry** | One page listing what is and isn't on testnet (Aave, USYC, others) so teams scope integrations correctly. |

---

## 5. Summary

Arc's USDC-native architecture is the right bet and we built on it willingly.
The friction was almost entirely in undocumented sharp edges and missing
developer tooling — nothing fundamental. Fix the filter persistence, document
the getLogs cap, open the USYC testnet path, and ship a minimal explorer and
the Arc developer experience goes from "workable with patience" to "genuinely
great." We'd build on Arc again.
