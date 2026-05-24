# Phase 2: Real PnL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every synthetic-PnL formula in the three agents with real numbers, while preserving Phase 1's vault-as-custody invariant. Cycles become 20 minutes, agent capital does a real CCTP roundtrip to HL testnet (Hermes/Pythia) or sits briefly in USYC (Demeter), and settlement reports realized exchange/teller deltas.

**Architecture:** Long-cycle full-roundtrip. Each cycle: vault → agent (Arc) → CCTP burn (Arc) → mint (HL testnet) → place perp → hold 10 min → close → read realized PnL → CCTP burn (HL) → mint (Arc) → allocator settles. Demeter skips the bridges and uses USYC Teller `deposit`/`redeem` for its real delta. All synthetic-PnL fallbacks are deleted (not gated); failed cycles settle 0 and emit a stuck event the operator clears with a recovery script.

**Tech Stack:** ethers v6, Hyperliquid testnet REST API (`/info`, `/exchange`), Circle CCTP V2 + Iris sandbox attestation, node:sqlite for allocator persistence, pnpm workspaces for the new `@themis/hl-client` package.

---

## Plan-wide notes

- All commits must NOT include `Co-Authored-By` trailers. Plain commit messages only.
- Work from the repo root unless a step says otherwise.
- This plan depends on Phase 1 being merged. `git log --oneline` should show commit `97fba80 Merge Phase 1: Foundation` and the 16 commits underneath it.
- 21 contract tests + 8 allocator tests are the existing baseline. Each task that touches tested code must keep these green.
- Phase 2 introduces external network dependencies (HL testnet, Iris testnet attestations). Tasks that need live network are flagged. Tasks that can run offline (refactors, env wiring, schema changes) come first.
- The implementer should run `pnpm abis` after any contract change. Phase 2 has only one contract change (T11 integration test) so this is usually a no-op.

---

## File map

| Path | Action | Owner |
|---|---|---|
| `scripts/verify-cctp-testnet.ts` | Create | T1 |
| `docs/cctp-testnet.md` | Create | T1 |
| `.env.example` | Modify (HL testnet defaults) | T2 |
| `packages/shared/src/timing.ts` | Create | T3 |
| `apps/agent-hermes/src/index.ts` | Modify (env timing) | T3 |
| `apps/agent-pythia/src/index.ts` | Modify (env timing) | T3 |
| `apps/agent-demeter/src/index.ts` | Modify (env timing) | T3 |
| `packages/hl-client/` | Create | T4 |
| `pnpm-workspace.yaml` | (Already covers `packages/*`) | T4 |
| `apps/agent-hermes/src/hl.ts` | Delete | T4 |
| `apps/agent-pythia/src/hl.ts` | Delete | T4 |
| `apps/agent-hermes/src/cctp.ts` | Create (extract burn helpers + add reverse) | T5 |
| `apps/agent-pythia/src/cctp.ts` | Create (same as hermes) | T5 |
| `apps/allocator/src/db.ts` | Modify (add stuck_reason column) | T6 |
| `apps/allocator/src/state.ts` | Modify (markStuck/clearStuck) | T6 |
| `apps/allocator/src/server.ts` | Modify (POST /stuck) | T6 |
| `apps/allocator/src/cycle.ts` | Modify (filter stuck) | T6 |
| `apps/allocator/test/state.test.ts` | Modify (stuck tests) | T6 |
| `apps/agent-hermes/src/index.ts` | Rewrite (real PnL, reverse bridge, delete fallback) | T7 |
| `apps/agent-hermes/src/execute.ts` | Refactor (use cctp.ts + hl-client) | T7 |
| `apps/agent-pythia/src/index.ts` | Rewrite (same as hermes) | T8 |
| `apps/agent-pythia/src/execute.ts` | Refactor | T8 |
| `apps/agent-pythia/src/data.ts` | Modify (headline cache + skip-on-stale) | T9 |
| `apps/agent-pythia/.headline-cache.json` | gitignored runtime file | T9 |
| `apps/agent-demeter/src/index.ts` | Rewrite (real shares-delta) | T10 |
| `apps/agent-demeter/src/execute.ts` | Modify (return shares, add redeem) | T10 |
| `apps/agent-demeter/.shares-held.json` | gitignored runtime file | T10 |
| `apps/contracts/test/DailyLossCap.integration.test.ts` | Create | T11 |
| `scripts/cctp-recover.ts` | Create | T12 |
| `.gitignore` | Modify (cache files) | T9 |

---

## Task 1: CCTP testnet verification spike + docs

This task writes a one-shot helper script that performs a $1 burn on Arc testnet, polls Iris sandbox for the attestation, and mints on HL testnet. The script PROVES our env values are correct before agent code depends on them. Then it documents the findings.

**Prereq:** an Arc testnet wallet with at least $2 USDC, and the HL testnet RPC URL reachable. The implementer does NOT need to actually run the script as part of completing this task — they only need to write it + the docs scaffold. Running it is an operator step before T7 begins.

**Files:**
- Create: `scripts/verify-cctp-testnet.ts`
- Create: `docs/cctp-testnet.md`

- [ ] **Step 1.1: Write the verification script**

```typescript
/**
 * One-shot CCTP V2 testnet verifier: burn $1 USDC on Arc testnet, poll Iris
 * sandbox for the attestation, mint on HL testnet. Confirms env values are
 * correct before agent code relies on them.
 *
 * Usage:
 *   pnpm tsx scripts/verify-cctp-testnet.ts
 *
 * Required env:
 *   ARC_RPC_URL                     Arc testnet RPC
 *   USDC_ADDRESS                    Arc-side USDC (0x3600...)
 *   CCTP_TOKEN_MESSENGER            Arc-side TokenMessenger
 *   HYPERLIQUID_CCTP_DOMAIN         CCTP destination domain (likely 19 for HL testnet)
 *   DEST_RPC_URL                    HL testnet RPC
 *   MESSAGE_TRANSMITTER_DEST        HL-side MessageTransmitter
 *   PRIVATE_KEY_HERMES              (or any wallet with >= $2 testnet USDC on Arc)
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const IRIS_SANDBOX = "https://iris-api-sandbox.circle.com/attestations";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
] as const;
const TM_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64 nonce)",
] as const;
const MT_ABI = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
] as const;

function addressToBytes32(addr: string): string {
  return "0x" + addr.slice(2).toLowerCase().padStart(64, "0");
}

async function pollIris(messageHash: string, maxAttempts = 60): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const resp = await fetch(`${IRIS_SANDBOX}/${messageHash}`);
    if (resp.ok) {
      const data = await resp.json() as { status: string; attestation?: string };
      console.log(`[verify-cctp] attempt ${i + 1}: status=${data.status}`);
      if (data.status === "complete" && data.attestation) return data.attestation;
    } else {
      console.log(`[verify-cctp] attempt ${i + 1}: http ${resp.status}`);
    }
  }
  throw new Error("Iris attestation timed out after 10 min");
}

async function main() {
  const required = ["ARC_RPC_URL", "USDC_ADDRESS", "CCTP_TOKEN_MESSENGER",
    "HYPERLIQUID_CCTP_DOMAIN", "DEST_RPC_URL", "MESSAGE_TRANSMITTER_DEST", "PRIVATE_KEY_HERMES"];
  for (const k of required) if (!process.env[k]) throw new Error(`Missing env: ${k}`);

  const amount = 1_000_000n; // $1.00 USDC (6 decimals)

  const srcProvider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const srcWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, srcProvider);
  console.log(`[verify-cctp] source wallet: ${srcWallet.address}`);

  const usdc = new ethers.Contract(process.env.USDC_ADDRESS!, ERC20_ABI, srcWallet);
  const balBefore = await usdc.balanceOf(srcWallet.address);
  console.log(`[verify-cctp] USDC balance on Arc: ${Number(balBefore) / 1e6}`);
  if (balBefore < amount) throw new Error("Source wallet needs >= $1 USDC on Arc testnet");

  // Step 1: approve TokenMessenger
  console.log(`[verify-cctp] approving TokenMessenger...`);
  const ax = await usdc.approve(process.env.CCTP_TOKEN_MESSENGER!, amount);
  await ax.wait();

  // Step 2: depositForBurn
  console.log(`[verify-cctp] burning $1 on Arc → destDomain ${process.env.HYPERLIQUID_CCTP_DOMAIN}...`);
  const tm = new ethers.Contract(process.env.CCTP_TOKEN_MESSENGER!, TM_ABI, srcWallet);
  const burnTx = await tm.depositForBurn(
    amount,
    Number(process.env.HYPERLIQUID_CCTP_DOMAIN!),
    addressToBytes32(srcWallet.address),
    process.env.USDC_ADDRESS!,
  );
  const burnReceipt = await burnTx.wait();
  console.log(`[verify-cctp] burn tx: ${burnReceipt!.hash}`);

  // Step 3: extract MessageSent log + hash the message
  const msLog = (burnReceipt!.logs as ethers.Log[]).find(
    l => l.topics[0] === ethers.id("MessageSent(bytes)")
  );
  if (!msLog) throw new Error("MessageSent log not found in burn receipt");
  const messageBytes = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], msLog.data)[0] as string;
  const messageHash = ethers.keccak256(messageBytes);
  console.log(`[verify-cctp] message hash: ${messageHash}`);

  // Step 4: poll Iris
  console.log(`[verify-cctp] polling Iris sandbox...`);
  const attestation = await pollIris(messageHash);
  console.log(`[verify-cctp] attestation received (${attestation.slice(0, 12)}...)`);

  // Step 5: mint on HL testnet
  const dstProvider = new ethers.JsonRpcProvider(process.env.DEST_RPC_URL!);
  const dstWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, dstProvider);
  const mt = new ethers.Contract(process.env.MESSAGE_TRANSMITTER_DEST!, MT_ABI, dstWallet);

  console.log(`[verify-cctp] receiveMessage on HL testnet...`);
  const mintTx = await mt.receiveMessage(messageBytes, attestation);
  const mintReceipt = await mintTx.wait();
  console.log(`[verify-cctp] mint tx: ${mintReceipt!.hash}`);

  console.log(`\n[verify-cctp] === ROUNDTRIP COMPLETE — env values verified ===`);
}

main().catch(e => { console.error("[verify-cctp] FAILED:", e); process.exit(1); });
```

- [ ] **Step 1.2: Create `docs/cctp-testnet.md` scaffold**

```markdown
# CCTP V2 testnet — Themis notes

## Verified environment values

| Variable | Value | Source |
|---|---|---|
| `ARC_CCTP_DOMAIN` | `26` | Arc testnet domain ID |
| `HYPERLIQUID_CCTP_DOMAIN` | `19` | _filled in after running `pnpm tsx scripts/verify-cctp-testnet.ts`_ |
| `MESSAGE_TRANSMITTER_DEST` | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | _verify against current Circle docs_ |
| Iris sandbox URL | `https://iris-api-sandbox.circle.com/attestations` | Circle CCTP V2 testnet docs |

## Observed timings

- **Iris attestation latency**: _measured_ ~Xs after burn confirmed
- **Total roundtrip (burn → mint)**: _measured_ ~Xs

(Operator: edit this file after running the verifier script, replace `X` with observed numbers.)

## Known gotchas

- HL testnet RPC may rate-limit during attestation polling — keep poll interval >= 10s.
- The `MessageSent(bytes)` event topic is `0x` + `keccak256("MessageSent(bytes)")`. Verify in the burn receipt before computing the message hash.
- The `mintRecipient` must be a left-zero-padded 32-byte representation of the destination wallet address.

## Recovery flow

If a burn succeeds but the mint never lands (Iris attestation appears but `receiveMessage` was never called), run:

```
pnpm tsx scripts/cctp-recover.ts <agentId> <burnTxHash>
```

The script re-fetches the attestation from Iris and calls `receiveMessage` on the destination chain.
```

- [ ] **Step 1.3: Commit**

```bash
git add scripts/verify-cctp-testnet.ts docs/cctp-testnet.md
git commit -m "feat(cctp): add testnet verification spike + docs scaffold"
```

(No execution gate — implementer doesn't need to run the script. Operator runs it before T7.)

---

## Task 2: HL testnet env switch in `.env.example`

**Files:**
- Modify: `.env.example`

- [ ] **Step 2.1: Replace the Hyperliquid + CCTP V2 destination block**

Open `.env.example`. Find the lines that currently say:

```env
# CCTP V2 — HyperEVM (destination for Hermes/Pythia)
HYPERLIQUID_CCTP_DOMAIN=19
MESSAGE_TRANSMITTER_DEST=0x81D40F21F12A8F0E3252Bccb954D722d4c464B64
# Use testnet: 0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275
DEST_RPC_URL=https://rpc.hyperliquid.xyz/evm
HYPERLIQUID_CHAIN_ID=999
```

…and the lines that say:

```env
HYPERLIQUID_API_URL=https://api.hyperliquid.xyz
HYPERLIQUID_INFO_URL=https://api.hyperliquid.xyz/info
```

REPLACE the union of those blocks with the following (testnet defaults, mainnet commented as fallback):

```env
# ---------------------------------------------------------------------------
# Hyperliquid (TESTNET by default — flip to mainnet by switching the blocks)
# ---------------------------------------------------------------------------
HYPERLIQUID_API_URL=https://api.hyperliquid-testnet.xyz
HYPERLIQUID_INFO_URL=https://api.hyperliquid-testnet.xyz/info
HYPERLIQUID_EXCHANGE_URL=https://api.hyperliquid-testnet.xyz/exchange
HYPERLIQUID_CHAIN_ID=998
DEST_RPC_URL=https://rpc.hyperliquid-testnet.xyz/evm

# CCTP V2 — HL testnet (destination for Hermes/Pythia)
HYPERLIQUID_CCTP_DOMAIN=19
MESSAGE_TRANSMITTER_DEST=0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275

# --- Mainnet alternative (commented; switch + restart to use) ---
# HYPERLIQUID_API_URL=https://api.hyperliquid.xyz
# HYPERLIQUID_INFO_URL=https://api.hyperliquid.xyz/info
# HYPERLIQUID_EXCHANGE_URL=https://api.hyperliquid.xyz/exchange
# HYPERLIQUID_CHAIN_ID=999
# DEST_RPC_URL=https://rpc.hyperliquid.xyz/evm
# MESSAGE_TRANSMITTER_DEST=0x81D40F21F12A8F0E3252Bccb954D722d4c464B64
```

- [ ] **Step 2.2: Add new agent timing env block (for T3)**

Append after the Hyperliquid block:

```env
# ---------------------------------------------------------------------------
# Agent timing (Phase 2 — 20-min full-roundtrip cycle, 10-min hold)
# ---------------------------------------------------------------------------
AGENT_CYCLE_MS=1200000        # 20 min — total cycle length
HERMES_HOLD_MS=600000         # 10 min — HL position hold window
PYTHIA_HOLD_MS=600000         # 10 min — HL position hold window
DEMETER_HOLD_MS=900000        # 15 min — USYC deposit hold window
ATTESTATION_TIMEOUT_MS=600000 # 10 min — Iris polling timeout
```

- [ ] **Step 2.3: Commit**

```bash
git add .env.example
git commit -m "feat(env): default to HL testnet; add Phase 2 cycle/hold/attestation timing"
```

---

## Task 3: Cycle/hold timing env vars in agents

Replace the hardcoded `CYCLE_MS = 60_000` in all three agents with env-driven values. Introduce a tiny shared `timing.ts` so the three agents read the same env keys consistently.

**Files:**
- Create: `packages/shared/src/timing.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/agent-hermes/src/index.ts`
- Modify: `apps/agent-pythia/src/index.ts`
- Modify: `apps/agent-demeter/src/index.ts`

- [ ] **Step 3.1: Create `packages/shared/src/timing.ts`**

```typescript
/**
 * Centralised agent timing constants, env-driven.
 * Defaults match the Phase 2 plan: 20-min cycle, 10-min hold, 10-min CCTP attestation timeout.
 */
export const AGENT_CYCLE_MS = Number(process.env.AGENT_CYCLE_MS ?? 1_200_000);
export const HERMES_HOLD_MS = Number(process.env.HERMES_HOLD_MS ?? 600_000);
export const PYTHIA_HOLD_MS = Number(process.env.PYTHIA_HOLD_MS ?? 600_000);
export const DEMETER_HOLD_MS = Number(process.env.DEMETER_HOLD_MS ?? 900_000);
export const ATTESTATION_TIMEOUT_MS = Number(process.env.ATTESTATION_TIMEOUT_MS ?? 600_000);
```

- [ ] **Step 3.2: Export from `packages/shared/src/index.ts`**

Open `packages/shared/src/index.ts`. The file currently reads:

```typescript
export * from "./types.js";
```

Append:

```typescript
export * from "./timing.js";
```

- [ ] **Step 3.3: Update agent-hermes to use the shared timing**

In `apps/agent-hermes/src/index.ts`, replace the line `const CYCLE_MS = 60_000;` with:

```typescript
import { AGENT_CYCLE_MS, HERMES_HOLD_MS } from "@themis/shared";
```

Replace the line `const SETTLE_DELAY_MS = position ? 5 * 60_000 : 30_000;` with:

```typescript
const SETTLE_DELAY_MS = position ? HERMES_HOLD_MS : 30_000;
```

The final `setInterval(cycle, CYCLE_MS);` line becomes:

```typescript
setInterval(cycle, AGENT_CYCLE_MS);
```

Do not change anything else in this file — full real-PnL rewrite is T7.

- [ ] **Step 3.4: Update agent-pythia identically**

In `apps/agent-pythia/src/index.ts`, apply the same three replacements but use `PYTHIA_HOLD_MS` instead of `HERMES_HOLD_MS`:

```typescript
import { AGENT_CYCLE_MS, PYTHIA_HOLD_MS } from "@themis/shared";
// ...
const SETTLE_DELAY_MS = position ? PYTHIA_HOLD_MS : 30_000;
// ...
setInterval(cycle, AGENT_CYCLE_MS);
```

- [ ] **Step 3.5: Update agent-demeter**

In `apps/agent-demeter/src/index.ts`, replace `const CYCLE_MS = 60_000;` with:

```typescript
import { AGENT_CYCLE_MS, DEMETER_HOLD_MS } from "@themis/shared";
```

Replace the line `}, 45_000);` (the simulated-yield settlement timeout) with:

```typescript
}, DEMETER_HOLD_MS);
```

Replace the final `setInterval(cycle, CYCLE_MS);` with:

```typescript
setInterval(cycle, AGENT_CYCLE_MS);
```

- [ ] **Step 3.6: Verify typechecks pass**

```bash
cd apps/agent-hermes && pnpm exec tsc --noEmit
cd ../agent-pythia && pnpm exec tsc --noEmit
cd ../agent-demeter && pnpm exec tsc --noEmit
```

Each should exit 0.

- [ ] **Step 3.7: Commit**

```bash
git add packages/shared/src/timing.ts packages/shared/src/index.ts \
        apps/agent-hermes/src/index.ts \
        apps/agent-pythia/src/index.ts \
        apps/agent-demeter/src/index.ts
git commit -m "feat(agents): replace hardcoded cycle/hold timings with env-driven shared constants"
```

---

## Task 4: Extract shared HL client into `packages/hl-client/`

The two agents' `hl.ts` files are identical (320 LOC each). Move them into a shared workspace package, delete both copies, update agent imports.

**Files:**
- Create: `packages/hl-client/package.json`
- Create: `packages/hl-client/tsconfig.json`
- Create: `packages/hl-client/src/index.ts`
- Create: `packages/hl-client/src/client.ts`
- Delete: `apps/agent-hermes/src/hl.ts`
- Delete: `apps/agent-pythia/src/hl.ts`
- Modify: `apps/agent-hermes/src/index.ts` (import path)
- Modify: `apps/agent-hermes/src/execute.ts` (import path)
- Modify: `apps/agent-pythia/src/index.ts` (import path)
- Modify: `apps/agent-pythia/src/execute.ts` (import path)
- Modify: `apps/agent-hermes/package.json` (add dep)
- Modify: `apps/agent-pythia/package.json` (add dep)

- [ ] **Step 4.1: Create `packages/hl-client/package.json`**

```json
{
  "name": "@themis/hl-client",
  "version": "0.0.1",
  "type": "module",
  "main": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "build": "tsc"
  },
  "dependencies": {
    "@themis/shared": "workspace:*",
    "ethers": "^6.11.0",
    "msgpackr": "^1.10.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 4.2: Create `packages/hl-client/tsconfig.json`**

Mirror `packages/shared/tsconfig.json`. Read it first:

```bash
cat packages/shared/tsconfig.json
```

Then create `packages/hl-client/tsconfig.json` with the same contents.

- [ ] **Step 4.3: Move `hl.ts` to the new package**

```bash
cp apps/agent-hermes/src/hl.ts packages/hl-client/src/client.ts
```

Edit `packages/hl-client/src/client.ts`. At the top of the file, find:

```typescript
const HL_INFO_URL     = "https://api.hyperliquid.xyz/info";
const HL_EXCHANGE_URL = "https://api.hyperliquid.xyz/exchange";
```

REPLACE those two lines with env-driven defaults that also accept testnet:

```typescript
const HL_INFO_URL     = process.env.HYPERLIQUID_INFO_URL ?? "https://api.hyperliquid-testnet.xyz/info";
const HL_EXCHANGE_URL = process.env.HYPERLIQUID_EXCHANGE_URL ?? "https://api.hyperliquid-testnet.xyz/exchange";
```

In the EIP-712 signing block (search for `chainId: 1337` — phantom-agent pattern), keep `chainId: 1337` unchanged. (The phantom-agent chainId is HL-protocol-specific, not the L2 chain ID. It is the SAME for mainnet and testnet.)

Leave the rest of the file unchanged.

- [ ] **Step 4.4: Create `packages/hl-client/src/index.ts`**

```typescript
export { placeHlOrder, closeHlPosition } from "./client.js";
```

(If the original `hl.ts` exported additional symbols, list them too. Verify with: `grep -n "^export " packages/hl-client/src/client.ts`.)

- [ ] **Step 4.5: Delete the duplicate copies**

```bash
rm apps/agent-hermes/src/hl.ts
rm apps/agent-pythia/src/hl.ts
```

- [ ] **Step 4.6: Update Hermes imports**

In `apps/agent-hermes/src/index.ts`, replace:
```typescript
import { closeHlPosition } from "./hl.js";
```
with:
```typescript
import { closeHlPosition } from "@themis/hl-client";
```

In `apps/agent-hermes/src/execute.ts`, replace:
```typescript
import { placeHlOrder } from "./hl.js";
```
with:
```typescript
import { placeHlOrder } from "@themis/hl-client";
```

- [ ] **Step 4.7: Update Pythia imports the same way**

In `apps/agent-pythia/src/index.ts`:
```typescript
// before
import { closeHlPosition } from "./hl.js";
// after
import { closeHlPosition } from "@themis/hl-client";
```

In `apps/agent-pythia/src/execute.ts`:
```typescript
// before
import { placeHlOrder } from "./hl.js";
// after
import { placeHlOrder } from "@themis/hl-client";
```

- [ ] **Step 4.8: Add `@themis/hl-client` to both agents' package.json**

In `apps/agent-hermes/package.json`, in the `dependencies` block, add `"@themis/hl-client": "workspace:*"`. Then in `apps/agent-pythia/package.json`, do the same.

For each file:
```bash
# Read first to get current shape
cat apps/agent-hermes/package.json
```

Edit it so the `dependencies` block includes the new entry (preserve the existing entries; just add the new one). Same for `apps/agent-pythia/package.json`.

- [ ] **Step 4.9: Install + verify**

```bash
pnpm install
cd apps/agent-hermes && pnpm exec tsc --noEmit
cd ../agent-pythia && pnpm exec tsc --noEmit
```

Both should exit 0. If the new package isn't picked up, run `pnpm install --force` and retry.

- [ ] **Step 4.10: Commit**

```bash
git add packages/hl-client/ \
        apps/agent-hermes/src/index.ts apps/agent-hermes/src/execute.ts apps/agent-hermes/package.json \
        apps/agent-pythia/src/index.ts apps/agent-pythia/src/execute.ts apps/agent-pythia/package.json \
        pnpm-lock.yaml
git add -u apps/agent-hermes/src/hl.ts apps/agent-pythia/src/hl.ts
git commit -m "refactor(hl): extract shared HL client into @themis/hl-client; env-drive URLs"
```

---

## Task 5: Add reverse-bridge CCTP module to each agent

Extract the burn→attestation→mint sequence into a per-agent `cctp.ts` module that exposes BOTH directions (`bridgeArcToHl` and `bridgeHlToArc`). Keep this per-agent (not shared) for now — agents may diverge in error handling later.

**Files:**
- Create: `apps/agent-hermes/src/cctp.ts`
- Create: `apps/agent-pythia/src/cctp.ts`

- [ ] **Step 5.1: Create `apps/agent-hermes/src/cctp.ts`**

```typescript
/**
 * Bidirectional CCTP V2 bridging for Hermes.
 *
 * `bridgeArcToHl(amountUsd6)`: burns USDC on Arc, polls Iris, mints on HL testnet.
 * `bridgeHlToArc(amountUsd6)`: burns USDC on HL testnet, polls Iris, mints on Arc.
 *
 * Both return the burn tx hash so the caller can recover stuck bridges
 * via scripts/cctp-recover.ts.
 */
import { ethers } from "ethers";
import { ATTESTATION_TIMEOUT_MS } from "@themis/shared";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const IRIS_API = "https://iris-api-sandbox.circle.com/attestations";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;
const TM_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64 nonce)",
] as const;
const MT_ABI = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
] as const;

const USDC_ADDRESS               = process.env.USDC_ADDRESS!;
const ARC_TOKEN_MESSENGER        = process.env.CCTP_TOKEN_MESSENGER!;
const ARC_MESSAGE_TRANSMITTER    = process.env.MESSAGE_TRANSMITTER_ARC ?? "";
const HL_TOKEN_MESSENGER         = process.env.CCTP_TOKEN_MESSENGER_HL ?? "";
const HL_MESSAGE_TRANSMITTER     = process.env.MESSAGE_TRANSMITTER_DEST!;
const ARC_CCTP_DOMAIN            = Number(process.env.ARC_CCTP_DOMAIN ?? "26");
const HYPERLIQUID_CCTP_DOMAIN    = Number(process.env.HYPERLIQUID_CCTP_DOMAIN ?? "19");

function addressToBytes32(addr: string): string {
  return "0x" + addr.slice(2).toLowerCase().padStart(64, "0");
}

async function pollIris(messageHash: string, tag: string): Promise<string | null> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < ATTESTATION_TIMEOUT_MS) {
    attempt++;
    await new Promise(r => setTimeout(r, 10_000));
    try {
      const resp = await fetch(`${IRIS_API}/${messageHash}`);
      if (resp.ok) {
        const data = await resp.json() as { status: string; attestation?: string };
        if (data.status === "complete" && data.attestation) return data.attestation;
        console.log(`${tag} attestation pending (attempt ${attempt})…`);
      }
    } catch { /* transient — retry */ }
  }
  console.warn(`${tag} attestation timed out after ${ATTESTATION_TIMEOUT_MS / 1000}s`);
  return null;
}

async function extractMessage(receipt: ethers.TransactionReceipt): Promise<{ messageBytes: string; messageHash: string } | null> {
  const log = (receipt.logs as ethers.Log[]).find(
    l => l.topics[0] === ethers.id("MessageSent(bytes)")
  );
  if (!log) return null;
  const messageBytes = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], log.data)[0] as string;
  return { messageBytes, messageHash: ethers.keccak256(messageBytes) };
}

/**
 * Bridge USDC from Arc → HL testnet. Returns burn tx hash + bridge status.
 * `status` is "complete" if mint landed, otherwise "stuck_attestation" or "stuck_mint".
 */
export async function bridgeArcToHl(amountUsd6: bigint): Promise<{ burnTxHash: string; status: "complete" | "stuck_attestation" | "stuck_mint" }> {
  const srcProvider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const srcWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, srcProvider);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, srcWallet);
  await (await usdc.approve(ARC_TOKEN_MESSENGER, amountUsd6)).wait();

  const tm = new ethers.Contract(ARC_TOKEN_MESSENGER, TM_ABI, srcWallet);
  const burnTx = await tm.depositForBurn(
    amountUsd6, HYPERLIQUID_CCTP_DOMAIN, addressToBytes32(srcWallet.address), USDC_ADDRESS,
  );
  const burnReceipt = await burnTx.wait();
  const burnTxHash = burnReceipt!.hash;
  console.log(`[hermes][cctp] burn on Arc: ${burnTxHash}`);

  const msg = await extractMessage(burnReceipt!);
  if (!msg) return { burnTxHash, status: "stuck_attestation" };

  const attestation = await pollIris(msg.messageHash, "[hermes][cctp][arc→hl]");
  if (!attestation) return { burnTxHash, status: "stuck_attestation" };

  try {
    const dstProvider = new ethers.JsonRpcProvider(process.env.DEST_RPC_URL!);
    const dstWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, dstProvider);
    const mt = new ethers.Contract(HL_MESSAGE_TRANSMITTER, MT_ABI, dstWallet);
    const mintTx = await mt.receiveMessage(msg.messageBytes, attestation);
    const mintReceipt = await mintTx.wait();
    console.log(`[hermes][cctp] mint on HL: ${mintReceipt!.hash}`);
    return { burnTxHash, status: "complete" };
  } catch (err) {
    console.warn(`[hermes][cctp] mint on HL failed:`, err);
    return { burnTxHash, status: "stuck_mint" };
  }
}

/**
 * Bridge USDC from HL testnet → Arc. Returns burn tx hash + bridge status.
 * Requires CCTP_TOKEN_MESSENGER_HL and MESSAGE_TRANSMITTER_ARC env vars.
 */
export async function bridgeHlToArc(amountUsd6: bigint): Promise<{ burnTxHash: string; status: "complete" | "stuck_attestation" | "stuck_mint" }> {
  if (!HL_TOKEN_MESSENGER || !ARC_MESSAGE_TRANSMITTER) {
    throw new Error("HL→Arc bridge requires CCTP_TOKEN_MESSENGER_HL and MESSAGE_TRANSMITTER_ARC env vars");
  }
  const srcProvider = new ethers.JsonRpcProvider(process.env.DEST_RPC_URL!);
  const srcWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, srcProvider);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, srcWallet);
  await (await usdc.approve(HL_TOKEN_MESSENGER, amountUsd6)).wait();

  const tm = new ethers.Contract(HL_TOKEN_MESSENGER, TM_ABI, srcWallet);
  const burnTx = await tm.depositForBurn(
    amountUsd6, ARC_CCTP_DOMAIN, addressToBytes32(srcWallet.address), USDC_ADDRESS,
  );
  const burnReceipt = await burnTx.wait();
  const burnTxHash = burnReceipt!.hash;
  console.log(`[hermes][cctp] burn on HL: ${burnTxHash}`);

  const msg = await extractMessage(burnReceipt!);
  if (!msg) return { burnTxHash, status: "stuck_attestation" };

  const attestation = await pollIris(msg.messageHash, "[hermes][cctp][hl→arc]");
  if (!attestation) return { burnTxHash, status: "stuck_attestation" };

  try {
    const dstProvider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
    const dstWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, dstProvider);
    const mt = new ethers.Contract(ARC_MESSAGE_TRANSMITTER, MT_ABI, dstWallet);
    const mintTx = await mt.receiveMessage(msg.messageBytes, attestation);
    const mintReceipt = await mintTx.wait();
    console.log(`[hermes][cctp] mint on Arc: ${mintReceipt!.hash}`);
    return { burnTxHash, status: "complete" };
  } catch (err) {
    console.warn(`[hermes][cctp] mint on Arc failed:`, err);
    return { burnTxHash, status: "stuck_mint" };
  }
}
```

- [ ] **Step 5.2: Create `apps/agent-pythia/src/cctp.ts`**

Copy the Hermes file exactly, but replace EVERY occurrence of `[hermes]` with `[pythia]` and `PRIVATE_KEY_HERMES` with `PRIVATE_KEY_PYTHIA`:

```bash
sed -e 's/\[hermes\]/[pythia]/g' \
    -e 's/PRIVATE_KEY_HERMES/PRIVATE_KEY_PYTHIA/g' \
    apps/agent-hermes/src/cctp.ts > apps/agent-pythia/src/cctp.ts
```

Verify:
```bash
grep -c "hermes\|HERMES" apps/agent-pythia/src/cctp.ts
```

Should return 0.

- [ ] **Step 5.3: Add new HL→Arc env vars to `.env.example`**

In `.env.example`, append a new block:

```env
# CCTP V2 — reverse bridge (HL testnet → Arc); set these to enable Hermes/Pythia settle path
CCTP_TOKEN_MESSENGER_HL=
MESSAGE_TRANSMITTER_ARC=
```

(Values get filled by the operator from the verify-cctp-testnet.ts spike output OR from Circle's docs for HL testnet TokenMessenger + Arc-side MessageTransmitter.)

- [ ] **Step 5.4: Typecheck**

```bash
cd apps/agent-hermes && pnpm exec tsc --noEmit
cd ../agent-pythia && pnpm exec tsc --noEmit
```

Both should exit 0.

- [ ] **Step 5.5: Commit**

```bash
git add apps/agent-hermes/src/cctp.ts apps/agent-pythia/src/cctp.ts .env.example
git commit -m "feat(cctp): add per-agent bidirectional bridge module (arc↔hl)"
```

---

## Task 6: Allocator stuck-agent tracking

Add a `stuck_reason` column to the allocator's SQLite, a `markStuck`/`clearStuck` pair, a `POST /stuck` endpoint agents call, and a cycle filter that skips stuck agents.

**Files:**
- Modify: `apps/allocator/src/db.ts`
- Modify: `apps/allocator/src/state.ts`
- Modify: `apps/allocator/src/server.ts`
- Modify: `apps/allocator/src/cycle.ts`
- Modify: `apps/allocator/test/state.test.ts`

- [ ] **Step 6.1: Write the failing test first**

In `apps/allocator/test/state.test.ts`, append a new `describe` block AFTER the existing one (before the file's closing brace if any):

```typescript
import { describe as describe2, it as it2, expect as expect2, beforeEach as beforeEach2, vi as vi2 } from "vitest";
// (you may need to dedupe the existing imports — keep one import line at top of file)
```

Actually — DON'T duplicate imports. Just add a NEW `describe` block using the imports already at the top of the file:

```typescript
describe("allocator stuck-agent tracking", () => {
  let tmp2: string;

  beforeEach(() => {
    tmp2 = mkdtempSync(join(tmpdir(), "themis-stuck-"));
    process.env.ALLOCATOR_DB_PATH = join(tmp2, "state.db");
    process.env.AGENT_ADDRESS_HERMES = "0x0000000000000000000000000000000000000001";
    process.env.AGENT_ADDRESS_PYTHIA = "0x0000000000000000000000000000000000000002";
    process.env.AGENT_ADDRESS_DEMETER = "0x0000000000000000000000000000000000000003";
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(tmp2, { recursive: true, force: true });
  });

  it("markStuck sets reason and clearStuck removes it; persists across re-import", async () => {
    const mod1 = await import("../src/state.js");
    mod1.state.markStuck("hermes", "cctp_attestation_timeout");
    expect(mod1.state.getAgentState("hermes").stuckReason).toBe("cctp_attestation_timeout");

    vi.resetModules();
    const mod2 = await import("../src/state.js");
    expect(mod2.state.getAgentState("hermes").stuckReason).toBe("cctp_attestation_timeout");

    mod2.state.clearStuck("hermes");
    expect(mod2.state.getAgentState("hermes").stuckReason).toBeNull();

    vi.resetModules();
    const mod3 = await import("../src/state.js");
    expect(mod3.state.getAgentState("hermes").stuckReason).toBeNull();
  });
});
```

Note: this test depends on `AgentState` having a new `stuckReason: string | null` field. Add it in step 6.2.

- [ ] **Step 6.2: Add `stuckReason` to the shared AgentState type**

Open `packages/shared/src/types.ts`. Find the `AgentState` type. Add a new field:

```typescript
  stuckReason: string | null;
```

(Put it next to the existing `sidelined: boolean` field for cohesion.)

- [ ] **Step 6.3: Add `stuck_reason` column to db.ts**

In `apps/allocator/src/db.ts`, modify the schema. Find:

```typescript
db.exec(`
  CREATE TABLE IF NOT EXISTS agent_state (
    agent_id TEXT PRIMARY KEY,
    trades_completed INTEGER NOT NULL DEFAULT 0,
    cumulative_pnl_today INTEGER NOT NULL DEFAULT 0,
    last_settle_day INTEGER NOT NULL DEFAULT 0
  );
  ...
```

REPLACE the entire `CREATE TABLE agent_state` block with:

```typescript
  CREATE TABLE IF NOT EXISTS agent_state (
    agent_id TEXT PRIMARY KEY,
    trades_completed INTEGER NOT NULL DEFAULT 0,
    cumulative_pnl_today INTEGER NOT NULL DEFAULT 0,
    last_settle_day INTEGER NOT NULL DEFAULT 0,
    stuck_reason TEXT
  );
```

Then immediately after the existing `CREATE INDEX` line, append the schema migration that adds the column when the table already exists (idempotent):

```typescript
// Idempotent migration for pre-Phase-2 DBs:
try { db.exec("ALTER TABLE agent_state ADD COLUMN stuck_reason TEXT"); } catch { /* already exists */ }
```

(Place this OUTSIDE the `db.exec("CREATE TABLE ...")` template, on a separate line.)

Update the prepared statements: replace the `upsertAgentState` statement with:

```typescript
export const upsertAgentState = db.prepare(`
  INSERT INTO agent_state (agent_id, trades_completed, cumulative_pnl_today, last_settle_day, stuck_reason)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(agent_id) DO UPDATE SET
    trades_completed = excluded.trades_completed,
    cumulative_pnl_today = excluded.cumulative_pnl_today,
    last_settle_day = excluded.last_settle_day,
    stuck_reason = excluded.stuck_reason
`);
```

Replace the `selectAgentState` statement with:

```typescript
export const selectAgentState = db.prepare(`
  SELECT trades_completed, cumulative_pnl_today, last_settle_day, stuck_reason FROM agent_state WHERE agent_id = ?
`);
```

Add a new dedicated stuck-only writer (cheaper than full upsert for stuck updates):

```typescript
export const setStuckReason = db.prepare(`
  INSERT INTO agent_state (agent_id, stuck_reason) VALUES (?, ?)
  ON CONFLICT(agent_id) DO UPDATE SET stuck_reason = excluded.stuck_reason
`);
```

- [ ] **Step 6.4: Modify `apps/allocator/src/state.ts` — hydrate + mutators**

In `apps/allocator/src/state.ts`, find the `makeState` function. Update its row-type cast + the returned object to include `stuckReason`:

```typescript
function makeState(agentId: AgentId): AgentState {
  const row = selectAgentState.get(agentId) as
    | { trades_completed: number; cumulative_pnl_today: number; last_settle_day: number; stuck_reason: string | null }
    | undefined;
  const history = (selectPnlHistory.all(agentId) as Array<{ ts: number; pnl_usdc6: number }>)
    .reverse()
    .map(r => ({ timestamp: r.ts, pnl: r.pnl_usdc6 / 1_000_000 }));

  const todayDay = Math.floor(Date.now() / 86_400_000);
  const cumulativeToday = row && row.last_settle_day === todayDay ? row.cumulative_pnl_today / 1_000_000 : 0;

  return {
    agentId,
    address: AGENT_ADDRESSES[agentId],
    tradesCompleted: row?.trades_completed ?? 0,
    currentAllocationUsd: 0,
    cumulativePnlToday: cumulativeToday,
    pnlHistory: history,
    sidelined: false,
    stuckReason: row?.stuck_reason ?? null,
  };
}
```

Update the imports at the top of state.ts to include `setStuckReason`:

```typescript
import { upsertAgentState, insertPnl, selectAgentState, selectPnlHistory, setStuckReason } from "./db.js";
```

Add two new methods to the `state` object (insert next to `recordSettlement`):

```typescript
  markStuck(agentId: AgentId, reason: string) {
    agentStates[agentId].stuckReason = reason;
    setStuckReason.run(agentId, reason);
  },

  clearStuck(agentId: AgentId) {
    agentStates[agentId].stuckReason = null;
    setStuckReason.run(agentId, null);
  },
```

- [ ] **Step 6.5: Add `POST /stuck` endpoint to `server.ts`**

In `apps/allocator/src/server.ts`, append a new route handler before the final `app.get("/state", ...)` line:

```typescript
app.post("/stuck", (req, res) => {
  const { agentId, reason } = req.body as { agentId: AgentId; reason?: string };
  if (!agentId) return res.status(400).json({ error: "agentId required" });
  if (reason === undefined || reason === null) {
    state.clearStuck(agentId);
    console.log(`[allocator] cleared stuck flag for ${agentId}`);
  } else {
    state.markStuck(agentId, reason);
    console.log(`[allocator] marked ${agentId} stuck: ${reason}`);
  }
  res.json({ ok: true });
});
```

- [ ] **Step 6.6: Filter stuck agents in `cycle.ts`**

In `apps/allocator/src/cycle.ts`, find the scoring line:

```typescript
const scored = proposals
  .filter(p => !agentStates[p.agentId].sidelined)
  .map(p => ({ proposal: p, s: score(agentStates[p.agentId], p) }))
  .sort((a, b) => b.s - a.s);
```

REPLACE the `.filter` line with:

```typescript
  .filter(p => !agentStates[p.agentId].sidelined && !agentStates[p.agentId].stuckReason)
```

- [ ] **Step 6.7: Run the new test — verify pass**

```bash
cd apps/allocator && pnpm test
```

Expected: 9 tests passing (the previous 8 plus the new stuck-tracking test).

- [ ] **Step 6.8: Commit**

```bash
git add packages/shared/src/types.ts \
        apps/allocator/src/db.ts apps/allocator/src/state.ts \
        apps/allocator/src/server.ts apps/allocator/src/cycle.ts \
        apps/allocator/test/state.test.ts
git commit -m "feat(allocator): track stuck-agent flag in SQLite + POST /stuck endpoint + cycle filter"
```

---

## Task 7: Hermes — real PnL settlement loop

Rewrite Hermes's cycle to do the full vault → CCTP → HL → close → CCTP → settle loop, using shared timing constants, the shared HL client (T4), the new cctp module (T5), and the stuck endpoint (T6). Delete every synthetic-PnL formula.

**Files:**
- Modify: `apps/agent-hermes/src/index.ts` (full rewrite)
- Modify: `apps/agent-hermes/src/execute.ts` (use cctp.ts; drop its own attestation polling)
- Modify: `apps/agent-hermes/src/propose.ts` (add `postStuck` helper)

- [ ] **Step 7.1: Add `postStuck` helper to `apps/agent-hermes/src/propose.ts`**

Read the current file:
```bash
cat apps/agent-hermes/src/propose.ts
```

It exports `submitProposal` and `reportSettlement`. Append a new function:

```typescript
export async function postStuck(agentId: string, reason: string | null): Promise<void> {
  const url = `${process.env.ALLOCATOR_URL ?? "http://localhost:3001"}/stuck`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, reason }),
  }).catch(err => console.warn(`[hermes] postStuck failed:`, err));
}
```

- [ ] **Step 7.2: Refactor `apps/agent-hermes/src/execute.ts` to use cctp.ts**

The current execute.ts inlines the entire CCTP burn-and-mint logic. Replace it with a thin wrapper that calls `bridgeArcToHl` from `./cctp.ts`, then places the HL order.

Read the current file's exports:
```bash
grep "^export " apps/agent-hermes/src/execute.ts
```

Replace the ENTIRE contents of `apps/agent-hermes/src/execute.ts` with:

```typescript
/**
 * Execute a Hermes trade:
 *   1. Bridge USDC from Arc → HL testnet via CCTP (uses cctp.ts).
 *   2. Place perp order on HL testnet (uses @themis/hl-client).
 *
 * Gated by ENABLE_REAL_TRADES=true. Returns null when bridge or order fails,
 * or when ENABLE_REAL_TRADES is false. The cycle in index.ts handles stuck
 * reporting and settle.
 */
import { AgentProposal } from "@themis/shared";
import { placeHlOrder } from "@themis/hl-client";
import { bridgeArcToHl } from "./cctp.js";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const ENABLE_REAL_TRADES = process.env.ENABLE_REAL_TRADES === "true";

export type HermesPosition = {
  fillPrice: number;
  coin: string;
  sizeInCoins: number;
  szDecimals: number;
  isBuy: boolean;
};

export type ExecuteResult =
  | { ok: true; position: HermesPosition }
  | { ok: false; reason: string; burnTxHash?: string };

export async function executeHermesTrade(
  proposal: AgentProposal,
  allocatedUsd: number,
): Promise<ExecuteResult> {
  if (!ENABLE_REAL_TRADES) {
    console.log(`[hermes] CCTP bridge skipped (ENABLE_REAL_TRADES=false): would trade ${allocatedUsd} USDC for ${proposal.tradeIdea}`);
    return { ok: false, reason: "real_trades_disabled" };
  }

  const amountUsdc6 = BigInt(Math.floor(allocatedUsd * 1_000_000));
  const bridge = await bridgeArcToHl(amountUsdc6);
  if (bridge.status !== "complete") {
    return { ok: false, reason: bridge.status, burnTxHash: bridge.burnTxHash };
  }

  const order = await placeHlOrder(
    process.env.PRIVATE_KEY_HERMES!,
    proposal,
    allocatedUsd,
    "hermes",
  ).catch(err => {
    console.warn(`[hermes] HL order placement failed:`, err);
    return null;
  });

  if (!order || order.fillPrice === null) {
    return { ok: false, reason: "hl_order_unfilled" };
  }

  return {
    ok: true,
    position: {
      fillPrice: order.fillPrice,
      coin: order.coin,
      sizeInCoins: order.sizeInCoins,
      szDecimals: order.szDecimals,
      isBuy: order.isBuy,
    },
  };
}
```

- [ ] **Step 7.3: Rewrite `apps/agent-hermes/src/index.ts` — real PnL cycle**

REPLACE the entire contents of `apps/agent-hermes/src/index.ts` with:

```typescript
import { fetchFundingRates } from "./data.js";
import { reason } from "./reason.js";
import { anchorTrace } from "./anchor.js";
import { submitProposal, reportSettlement, postStuck } from "./propose.js";
import { executeHermesTrade, HermesPosition } from "./execute.js";
import { closeHlPosition } from "@themis/hl-client";
import { bridgeHlToArc } from "./cctp.js";
import { AGENT_CYCLE_MS, HERMES_HOLD_MS } from "@themis/shared";

async function holdAndClose(position: HermesPosition, allocatedUsd: number): Promise<number | null> {
  await new Promise(r => setTimeout(r, HERMES_HOLD_MS));
  const close = await closeHlPosition(
    process.env.PRIVATE_KEY_HERMES!,
    position.coin,
    position.sizeInCoins,
    position.szDecimals,
    position.isBuy,
    "hermes",
  ).catch(err => {
    console.warn(`[hermes] HL close failed:`, err);
    return null;
  });
  if (!close) return null;
  const pct = (close.exitPrice - position.fillPrice) / position.fillPrice;
  return pct * allocatedUsd * (position.isBuy ? 1 : -1);
}

async function cycle(): Promise<void> {
  console.log(`[hermes] cycle start ${new Date().toISOString()}`);
  try {
    const data = await fetchFundingRates();
    const proposal = await reason(data);

    const { cid, hash } = await anchorTrace(
      { proposal, data },
      proposal.tradeIdea,
      proposal.confidence,
    );

    const { reasoning, ...clean } = proposal;
    clean.reasoningTraceCid = cid;
    clean.reasoningHash = hash;
    clean.timestamp = Math.floor(Date.now() / 1000);

    await submitProposal(clean);
    console.log(`[hermes] submitted: ${clean.tradeIdea} (conf=${clean.confidence})`);

    // Wait briefly for the allocator to score + call vault.allocate, then act.
    await new Promise(r => setTimeout(r, 30_000));

    const exec = await executeHermesTrade(clean, clean.requestedSizeUsd);
    if (!exec.ok) {
      if (exec.reason === "real_trades_disabled") {
        await reportSettlement("hermes", 0);
        return;
      }
      console.warn(`[hermes] execute failed: ${exec.reason} (burn=${exec.burnTxHash ?? "n/a"})`);
      await postStuck("hermes", `execute:${exec.reason}${exec.burnTxHash ? `:${exec.burnTxHash}` : ""}`);
      return;
    }

    const pnlUsd = await holdAndClose(exec.position, clean.requestedSizeUsd);
    if (pnlUsd === null) {
      await postStuck("hermes", "hl_close_failed");
      return;
    }
    console.log(`[hermes] real HL PnL: $${pnlUsd.toFixed(4)}`);

    // Bridge proceeds back so the vault can pull on settle.
    const proceedsUsd = clean.requestedSizeUsd + pnlUsd;
    const proceedsUsd6 = BigInt(Math.max(0, Math.floor(proceedsUsd * 1_000_000)));
    if (proceedsUsd6 > 0n) {
      const back = await bridgeHlToArc(proceedsUsd6);
      if (back.status !== "complete") {
        await postStuck("hermes", `reverse_bridge:${back.status}:${back.burnTxHash}`);
        return;
      }
    }

    await reportSettlement("hermes", pnlUsd);
    console.log(`[hermes] settlement reported: $${pnlUsd.toFixed(4)}`);
  } catch (err) {
    console.error(`[hermes] cycle error:`, err);
    await postStuck("hermes", `unhandled:${(err as Error).message?.slice(0, 80) ?? "unknown"}`).catch(() => {});
  }
}

cycle();
setInterval(cycle, AGENT_CYCLE_MS);
```

- [ ] **Step 7.4: Typecheck**

```bash
cd apps/agent-hermes && pnpm exec tsc --noEmit
```

Expected: exit 0. If TypeScript complains about `HermesPosition` import, confirm it's exported from execute.ts.

- [ ] **Step 7.5: Smoke-run with real trades disabled**

```bash
cd /Users/romariokavin/Documents/PersonalProjects/themis
export ENABLE_REAL_TRADES=false
timeout 70 pnpm --filter @themis/agent-hermes dev || true
unset ENABLE_REAL_TRADES
```

Expected log sequence within ~70s: `cycle start` → `submitted: ...` → `execute failed: real_trades_disabled` → `settlement reported: $0.0000`. No `Math.random` PnL ever appears. The process is killed by `timeout` after 70s — exit code 124 is expected.

- [ ] **Step 7.6: Commit**

```bash
git add apps/agent-hermes/src/index.ts \
        apps/agent-hermes/src/execute.ts \
        apps/agent-hermes/src/propose.ts
git commit -m "feat(hermes): real-PnL cycle (CCTP roundtrip + HL position close); delete synthetic fallback"
```

---

## Task 8: Pythia — same shape as Hermes

Pythia mirrors Hermes structurally. The differences:
- Data source is `fetchNewsHeadlines` not `fetchFundingRates`.
- Holds "hold"-action skips early (already there).
- Uses `PYTHIA_HOLD_MS` and `PRIVATE_KEY_PYTHIA`.

**Files:**
- Modify: `apps/agent-pythia/src/index.ts`
- Modify: `apps/agent-pythia/src/execute.ts`
- Modify: `apps/agent-pythia/src/propose.ts`

- [ ] **Step 8.1: Add `postStuck` to `apps/agent-pythia/src/propose.ts`**

Same pattern as Hermes — append:

```typescript
export async function postStuck(agentId: string, reason: string | null): Promise<void> {
  const url = `${process.env.ALLOCATOR_URL ?? "http://localhost:3001"}/stuck`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId, reason }),
  }).catch(err => console.warn(`[pythia] postStuck failed:`, err));
}
```

- [ ] **Step 8.2: Rewrite `apps/agent-pythia/src/execute.ts`**

Replace the ENTIRE contents with (mirror of Hermes's execute.ts, with pythia naming):

```typescript
import { AgentProposal } from "@themis/shared";
import { placeHlOrder } from "@themis/hl-client";
import { bridgeArcToHl } from "./cctp.js";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const ENABLE_REAL_TRADES = process.env.ENABLE_REAL_TRADES === "true";

export type PythiaPosition = {
  fillPrice: number;
  coin: string;
  sizeInCoins: number;
  szDecimals: number;
  isBuy: boolean;
};

export type ExecuteResult =
  | { ok: true; position: PythiaPosition }
  | { ok: false; reason: string; burnTxHash?: string };

export async function executePythiaTrade(
  proposal: AgentProposal,
  allocatedUsd: number,
): Promise<ExecuteResult> {
  if (!ENABLE_REAL_TRADES) {
    console.log(`[pythia] CCTP bridge skipped (ENABLE_REAL_TRADES=false): would trade ${allocatedUsd} USDC for ${proposal.tradeIdea}`);
    return { ok: false, reason: "real_trades_disabled" };
  }

  const amountUsdc6 = BigInt(Math.floor(allocatedUsd * 1_000_000));
  const bridge = await bridgeArcToHl(amountUsdc6);
  if (bridge.status !== "complete") {
    return { ok: false, reason: bridge.status, burnTxHash: bridge.burnTxHash };
  }

  const order = await placeHlOrder(
    process.env.PRIVATE_KEY_PYTHIA!,
    proposal,
    allocatedUsd,
    "pythia",
  ).catch(err => {
    console.warn(`[pythia] HL order placement failed:`, err);
    return null;
  });

  if (!order || order.fillPrice === null) {
    return { ok: false, reason: "hl_order_unfilled" };
  }

  return {
    ok: true,
    position: {
      fillPrice: order.fillPrice,
      coin: order.coin,
      sizeInCoins: order.sizeInCoins,
      szDecimals: order.szDecimals,
      isBuy: order.isBuy,
    },
  };
}
```

- [ ] **Step 8.3: Rewrite `apps/agent-pythia/src/index.ts`**

```typescript
import { fetchNewsHeadlines } from "./data.js";
import { reason } from "./reason.js";
import { anchorTrace } from "./anchor.js";
import { submitProposal, reportSettlement, postStuck } from "./propose.js";
import { executePythiaTrade, PythiaPosition } from "./execute.js";
import { closeHlPosition } from "@themis/hl-client";
import { bridgeHlToArc } from "./cctp.js";
import { AGENT_CYCLE_MS, PYTHIA_HOLD_MS } from "@themis/shared";

async function holdAndClose(position: PythiaPosition, allocatedUsd: number): Promise<number | null> {
  await new Promise(r => setTimeout(r, PYTHIA_HOLD_MS));
  const close = await closeHlPosition(
    process.env.PRIVATE_KEY_PYTHIA!,
    position.coin,
    position.sizeInCoins,
    position.szDecimals,
    position.isBuy,
    "pythia",
  ).catch(err => {
    console.warn(`[pythia] HL close failed:`, err);
    return null;
  });
  if (!close) return null;
  const pct = (close.exitPrice - position.fillPrice) / position.fillPrice;
  return pct * allocatedUsd * (position.isBuy ? 1 : -1);
}

async function cycle(): Promise<void> {
  console.log(`[pythia] cycle start ${new Date().toISOString()}`);
  try {
    const news = await fetchNewsHeadlines();
    const proposal = await reason(news);
    if (proposal.action === "hold") {
      console.log("[pythia] holding this cycle");
      return;
    }

    const { cid, hash } = await anchorTrace(
      { proposal, news },
      proposal.tradeIdea,
      proposal.confidence,
    );

    const { reasoning, ...clean } = proposal;
    clean.reasoningTraceCid = cid;
    clean.reasoningHash = hash;
    clean.timestamp = Math.floor(Date.now() / 1000);

    await submitProposal(clean);
    console.log(`[pythia] submitted: ${clean.tradeIdea}`);

    await new Promise(r => setTimeout(r, 30_000));

    const exec = await executePythiaTrade(clean, clean.requestedSizeUsd);
    if (!exec.ok) {
      if (exec.reason === "real_trades_disabled") {
        await reportSettlement("pythia", 0);
        return;
      }
      console.warn(`[pythia] execute failed: ${exec.reason} (burn=${exec.burnTxHash ?? "n/a"})`);
      await postStuck("pythia", `execute:${exec.reason}${exec.burnTxHash ? `:${exec.burnTxHash}` : ""}`);
      return;
    }

    const pnlUsd = await holdAndClose(exec.position, clean.requestedSizeUsd);
    if (pnlUsd === null) {
      await postStuck("pythia", "hl_close_failed");
      return;
    }
    console.log(`[pythia] real HL PnL: $${pnlUsd.toFixed(4)}`);

    const proceedsUsd = clean.requestedSizeUsd + pnlUsd;
    const proceedsUsd6 = BigInt(Math.max(0, Math.floor(proceedsUsd * 1_000_000)));
    if (proceedsUsd6 > 0n) {
      const back = await bridgeHlToArc(proceedsUsd6);
      if (back.status !== "complete") {
        await postStuck("pythia", `reverse_bridge:${back.status}:${back.burnTxHash}`);
        return;
      }
    }

    await reportSettlement("pythia", pnlUsd);
    console.log(`[pythia] settlement reported: $${pnlUsd.toFixed(4)}`);
  } catch (err) {
    console.error(`[pythia] cycle error:`, err);
    await postStuck("pythia", `unhandled:${(err as Error).message?.slice(0, 80) ?? "unknown"}`).catch(() => {});
  }
}

cycle();
setInterval(cycle, AGENT_CYCLE_MS);
```

- [ ] **Step 8.4: Typecheck**

```bash
cd apps/agent-pythia && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 8.5: Commit**

```bash
git add apps/agent-pythia/src/index.ts \
        apps/agent-pythia/src/execute.ts \
        apps/agent-pythia/src/propose.ts
git commit -m "feat(pythia): real-PnL cycle (CCTP roundtrip + HL close); delete synthetic fallback"
```

---

## Task 9: Pythia — headline cache + skip-on-stale

When Twitter+RSS both fail, cache the last real headline and skip the cycle entirely if the cache is older than 30 min. No more "Crypto markets steady" identical-cycle bug.

**Files:**
- Modify: `apps/agent-pythia/src/data.ts`
- Modify: `.gitignore` (add `*.headline-cache.json`)

- [ ] **Step 9.1: Modify `apps/agent-pythia/src/data.ts`**

Add at the top of the file, after the existing imports:

```typescript
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, "../.headline-cache.json");
const CACHE_TTL_MS = 30 * 60_000; // 30 min

function readCache(): { items: NewsItem[]; ts: number } | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as { items: NewsItem[]; ts: number };
  } catch { return null; }
}

function writeCache(items: NewsItem[]): void {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify({ items, ts: Date.now() }));
  } catch (err) { console.warn(`[pythia] headline cache write failed:`, err); }
}

export class StaleHeadlinesError extends Error {
  constructor() { super("All data sources failed and cache is stale (>30min)"); }
}
```

Then REPLACE the existing `fetchNewsHeadlines` function. The current shape is `try Twitter → catch try RSS → catch return fallback`. The new shape is `try Twitter → catch try RSS → catch use cache if fresh; else throw StaleHeadlinesError`.

Replace the function body so the function reads:

```typescript
export async function fetchNewsHeadlines(): Promise<NewsItem[]> {
  try {
    const paymentHeader = pythiaWallet ? await payForDataCall(pythiaWallet, "twitter.com/crypto-headlines") : null;
    const resp = await axios.get(
      "https://api.twitter.com/2/tweets/search/recent?query=bitcoin+OR+ethereum+crypto+lang:en&max_results=10&tweet.fields=created_at",
      {
        headers: {
          Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}`,
          ...(paymentHeader ? { "X-Payment": paymentHeader } : {}),
        },
      }
    );
    const items: NewsItem[] = (resp.data.data ?? []).map((t: any) => ({
      title: t.text,
      source: "twitter",
      publishedAt: t.created_at,
    }));
    if (items.length > 0) { writeCache(items); return items; }
  } catch { /* fall through */ }

  try {
    const rssPaymentHeader = pythiaWallet ? await payForDataCall(pythiaWallet, "coindesk.com/rss", 500) : null;
    const rss = await axios.get("https://www.coindesk.com/arc/outboundfeeds/rss/", {
      headers: {
        "User-Agent": "Themis/1.0",
        ...(rssPaymentHeader ? { "X-Payment": rssPaymentHeader } : {}),
      },
    });
    const matches = [...rss.data.matchAll(/<title><!\[CDATA\[(.+?)\]\]><\/title>/g)];
    const items: NewsItem[] = matches.slice(0, 10).map((m: RegExpMatchArray) => ({
      title: m[1],
      source: "coindesk",
      publishedAt: new Date().toISOString(),
    }));
    if (items.length > 0) { writeCache(items); return items; }
  } catch { /* fall through */ }

  const cached = readCache();
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    console.warn(`[pythia] live data sources failed; using cache (age ${Math.round((Date.now() - cached.ts) / 1000)}s)`);
    return cached.items;
  }

  throw new StaleHeadlinesError();
}
```

- [ ] **Step 9.2: Handle StaleHeadlinesError in `index.ts`**

In `apps/agent-pythia/src/index.ts`, find the `try {` block at the top of `cycle()`. Currently the first call is:

```typescript
    const news = await fetchNewsHeadlines();
```

This throws `StaleHeadlinesError` when there's nothing fresh. The outer `catch (err)` block ALREADY catches this and posts stuck. We can be smarter: a stale headlines situation is not a "stuck agent" — it's a "skip this cycle, try again next cycle".

Add this import at the top of `index.ts`:

```typescript
import { fetchNewsHeadlines, StaleHeadlinesError } from "./data.js";
```

Wrap the `fetchNewsHeadlines` call in a try/catch BEFORE the existing try:

```typescript
async function cycle(): Promise<void> {
  console.log(`[pythia] cycle start ${new Date().toISOString()}`);
  let news;
  try {
    news = await fetchNewsHeadlines();
  } catch (err) {
    if (err instanceof StaleHeadlinesError) {
      console.warn(`[pythia] skipping cycle: ${err.message}`);
      return;
    }
    throw err;
  }
  try {
    const proposal = await reason(news);
    // ...rest unchanged
```

You'll need to remove the `const news = await fetchNewsHeadlines();` line from inside the existing `try` block so it isn't called twice.

- [ ] **Step 9.3: Add cache file to .gitignore**

In `.gitignore` (at repo root), append:

```
# Pythia runtime headline cache
apps/agent-pythia/.headline-cache.json
```

- [ ] **Step 9.4: Typecheck**

```bash
cd apps/agent-pythia && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 9.5: Commit**

```bash
git add apps/agent-pythia/src/data.ts apps/agent-pythia/src/index.ts .gitignore
git commit -m "feat(pythia): headline cache + skip cycle when both live sources fail and cache stale"
```

---

## Task 10: Demeter — real shares-delta PnL

Demeter currently `teller.deposit` but never reads back shares minted, never `teller.redeem`s, and reports a synthetic APY. Real PnL = USDC out minus USDC in. Track `sharesHeld` per cycle in a small file (gitignored).

**Files:**
- Modify: `apps/agent-demeter/src/execute.ts` (return shares; add redeem)
- Modify: `apps/agent-demeter/src/index.ts` (real delta settlement)
- Modify: `.gitignore` (cache file)

- [ ] **Step 10.1: Rewrite `apps/agent-demeter/src/execute.ts`**

Two functions now: `depositToVenue` (returns sharesHeld) and `redeemFromVenue` (returns USDC delta). The existing `executeDemeterRotation` becomes `depositToVenue` with a return shape.

REPLACE the entire contents of `apps/agent-demeter/src/execute.ts` with:

```typescript
/**
 * Demeter venue execution: deposit USDC into USYC (or Aave) and later redeem
 * to compute realized yield delta.
 *
 * USYC Teller is a real ERC-4626-style vault on Arc:
 *   deposit(assets, receiver) → shares
 *   redeem(shares, receiver, owner) → assets
 *
 * Aave on Arc is not yet deployed — supply() works when AAVE_POOL_ADDRESS is set.
 */
import { ethers } from "ethers";
import { AgentProposal } from "@themis/shared";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const ENABLE_REAL_TRADES = process.env.ENABLE_REAL_TRADES === "true";

const USDC_ADDRESS        = process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
const USYC_ADDRESS        = process.env.USYC_ADDRESS ?? "";
const USYC_TELLER_ADDRESS = process.env.USYC_TELLER_ADDRESS ?? "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A";
const AAVE_POOL           = process.env.AAVE_POOL_ADDRESS ?? "";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
] as const;

const USYC_TELLER_ABI = [
  "function deposit(uint256 assets, address receiver) returns (uint256 shares)",
  "function redeem(uint256 shares, address receiver, address owner) returns (uint256 assets)",
] as const;

const AAVE_POOL_ABI = [
  "function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)",
  "function withdraw(address asset, uint256 amount, address to) returns (uint256)",
] as const;

export type DepositResult =
  | { ok: true; venue: string; sharesHeld: bigint; depositedUsd6: bigint }
  | { ok: false; reason: string };

export type RedeemResult =
  | { ok: true; receivedUsd6: bigint }
  | { ok: false; reason: string };

export async function depositToVenue(proposal: AgentProposal, allocatedUsd: number): Promise<DepositResult> {
  const venue = proposal.venue;
  const amountUsdc6 = BigInt(Math.floor(allocatedUsd * 1_000_000));

  if (!ENABLE_REAL_TRADES) {
    console.log(`[demeter] deposit skipped (ENABLE_REAL_TRADES=false): would deposit ${allocatedUsd} USDC into ${venue}`);
    return { ok: false, reason: "real_trades_disabled" };
  }

  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY_DEMETER!, provider);
  const usdc     = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);

  if (venue === "usyc") {
    if (!USYC_ADDRESS) return { ok: false, reason: "usyc_address_unset" };
    const usyc = new ethers.Contract(USYC_ADDRESS, ERC20_ABI, wallet);
    const sharesBefore = await usyc.balanceOf(wallet.address);
    await (await usdc.approve(USYC_TELLER_ADDRESS, amountUsdc6)).wait();
    const teller = new ethers.Contract(USYC_TELLER_ADDRESS, USYC_TELLER_ABI, wallet);
    const tx = await teller.deposit(amountUsdc6, wallet.address);
    const receipt = await tx.wait();
    const sharesAfter = await usyc.balanceOf(wallet.address);
    const sharesHeld = sharesAfter - sharesBefore;
    console.log(`[demeter] USYC deposit ok (tx: ${receipt?.hash}); sharesHeld delta = ${sharesHeld}`);
    return { ok: true, venue: "usyc", sharesHeld, depositedUsd6: amountUsdc6 };
  }

  if (venue === "aave") {
    if (!AAVE_POOL) return { ok: false, reason: "aave_pool_unset" };
    await (await usdc.approve(AAVE_POOL, amountUsdc6)).wait();
    const aave = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, wallet);
    const tx = await aave.supply(USDC_ADDRESS, amountUsdc6, wallet.address, 0);
    const receipt = await tx.wait();
    console.log(`[demeter] Aave supply ok (tx: ${receipt?.hash})`);
    return { ok: true, venue: "aave", sharesHeld: amountUsdc6, depositedUsd6: amountUsdc6 };
  }

  return { ok: false, reason: `unknown_venue:${venue}` };
}

export async function redeemFromVenue(venue: string, sharesHeld: bigint, depositedUsd6: bigint): Promise<RedeemResult> {
  if (!ENABLE_REAL_TRADES) {
    return { ok: false, reason: "real_trades_disabled" };
  }
  if (sharesHeld <= 0n) {
    return { ok: false, reason: "no_shares_to_redeem" };
  }

  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY_DEMETER!, provider);
  const usdc     = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);

  if (venue === "usyc") {
    const balBefore = await usdc.balanceOf(wallet.address);
    const teller = new ethers.Contract(USYC_TELLER_ADDRESS, USYC_TELLER_ABI, wallet);
    const tx = await teller.redeem(sharesHeld, wallet.address, wallet.address);
    const receipt = await tx.wait();
    const balAfter = await usdc.balanceOf(wallet.address);
    const receivedUsd6 = balAfter - balBefore;
    console.log(`[demeter] USYC redeem ok (tx: ${receipt?.hash}); received ${receivedUsd6} usdc6 vs deposited ${depositedUsd6}`);
    return { ok: true, receivedUsd6 };
  }

  if (venue === "aave") {
    if (!AAVE_POOL) return { ok: false, reason: "aave_pool_unset" };
    const balBefore = await usdc.balanceOf(wallet.address);
    const aave = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, wallet);
    const tx = await aave.withdraw(USDC_ADDRESS, sharesHeld, wallet.address);
    const receipt = await tx.wait();
    const balAfter = await usdc.balanceOf(wallet.address);
    return { ok: true, receivedUsd6: balAfter - balBefore };
  }

  return { ok: false, reason: `unknown_venue:${venue}` };
}
```

- [ ] **Step 10.2: Rewrite `apps/agent-demeter/src/index.ts`**

REPLACE the entire contents with:

```typescript
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchYieldRates } from "./data.js";
import { reason } from "./reason.js";
import { anchorTrace } from "./anchor.js";
import { submitProposal, reportSettlement } from "./propose.js";
import { depositToVenue, redeemFromVenue } from "./execute.js";
import { AGENT_CYCLE_MS, DEMETER_HOLD_MS } from "@themis/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARES_PATH = join(__dirname, "../.shares-held.json");

type ShareSlot = { venue: string; sharesHeld: string; depositedUsd6: string; openedAt: number };

function readShareSlot(): ShareSlot | null {
  if (!existsSync(SHARES_PATH)) return null;
  try { return JSON.parse(readFileSync(SHARES_PATH, "utf8")) as ShareSlot; } catch { return null; }
}
function writeShareSlot(slot: ShareSlot | null): void {
  if (!slot) {
    try { writeFileSync(SHARES_PATH, "null"); } catch { /* ignore */ }
    return;
  }
  writeFileSync(SHARES_PATH, JSON.stringify(slot));
}

async function postStuck(reason: string | null): Promise<void> {
  const url = `${process.env.ALLOCATOR_URL ?? "http://localhost:3001"}/stuck`;
  await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId: "demeter", reason }),
  }).catch(err => console.warn(`[demeter] postStuck failed:`, err));
}

async function cycle(): Promise<void> {
  console.log(`[demeter] cycle start ${new Date().toISOString()}`);
  try {
    const data = await fetchYieldRates();
    const proposal = await reason(data);

    const { cid, hash } = await anchorTrace(
      { proposal, data }, proposal.tradeIdea, proposal.confidence,
    );

    const { reasoning, ...clean } = proposal;
    clean.reasoningTraceCid = cid;
    clean.reasoningHash = hash;
    clean.timestamp = Math.floor(Date.now() / 1000);

    await submitProposal(clean);
    console.log(`[demeter] submitted: ${clean.tradeIdea}`);

    // Wait for allocator scoring + vault.allocate
    await new Promise(r => setTimeout(r, 30_000));

    const dep = await depositToVenue(clean, clean.requestedSizeUsd);
    if (!dep.ok) {
      if (dep.reason === "real_trades_disabled") {
        await reportSettlement("demeter", 0);
        return;
      }
      await postStuck(`deposit:${dep.reason}`);
      return;
    }

    writeShareSlot({
      venue: dep.venue,
      sharesHeld: dep.sharesHeld.toString(),
      depositedUsd6: dep.depositedUsd6.toString(),
      openedAt: Date.now(),
    });

    // Hold then redeem.
    await new Promise(r => setTimeout(r, DEMETER_HOLD_MS));

    const slot = readShareSlot();
    if (!slot) {
      await postStuck("shares_slot_missing_on_redeem");
      return;
    }
    const red = await redeemFromVenue(slot.venue, BigInt(slot.sharesHeld), BigInt(slot.depositedUsd6));
    if (!red.ok) {
      await postStuck(`redeem:${red.reason}`);
      return;
    }
    writeShareSlot(null);

    const pnlUsd = Number(red.receivedUsd6 - BigInt(slot.depositedUsd6)) / 1_000_000;
    await reportSettlement("demeter", pnlUsd);
    console.log(`[demeter] real yield settlement: $${pnlUsd.toFixed(6)} (delta over $${(Number(BigInt(slot.depositedUsd6)) / 1_000_000).toFixed(2)})`);
  } catch (err) {
    console.error(`[demeter] cycle error:`, err);
    await postStuck(`unhandled:${(err as Error).message?.slice(0, 80) ?? "unknown"}`).catch(() => {});
  }
}

cycle();
setInterval(cycle, AGENT_CYCLE_MS);
```

- [ ] **Step 10.3: Add the shares-held cache to .gitignore**

In `.gitignore`, append:

```
# Demeter runtime shares-held slot
apps/agent-demeter/.shares-held.json
```

- [ ] **Step 10.4: Typecheck**

```bash
cd apps/agent-demeter && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 10.5: Commit**

```bash
git add apps/agent-demeter/src/index.ts apps/agent-demeter/src/execute.ts .gitignore
git commit -m "feat(demeter): real shares-delta PnL (USYC deposit/redeem); delete synthetic APY"
```

---

## Task 11: Daily loss cap end-to-end integration test

A new contract test that uses the FULL Phase 2 vault flow to verify the −5% daily loss cap actually fires. This protects against regressions if either `allocate`/`settle` math changes.

**Files:**
- Create: `apps/contracts/test/DailyLossCap.integration.test.ts`

- [ ] **Step 11.1: Write the test**

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";
import { ThemisVault, ERC20Mock } from "../typechain-types";

describe("ThemisVault — daily loss cap integration", () => {
  let vault: ThemisVault;
  let usdc: ERC20Mock;
  let admin: any, allocator: any, agent: any, user: any;

  beforeEach(async () => {
    [admin, allocator, agent, user] = await ethers.getSigners();
    const Mock = await ethers.getContractFactory("ERC20Mock");
    usdc = await Mock.deploy("USD Coin", "USDC", 6) as ERC20Mock;
    const Vault = await ethers.getContractFactory("ThemisVault");
    vault = await Vault.deploy(await usdc.getAddress(), allocator.address) as ThemisVault;

    // Mint + deposit
    await usdc.mint(user.address, ethers.parseUnits("1000", 6));
    await usdc.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(user).deposit(ethers.parseUnits("100", 6));

    // Agent approves vault for settle pulls
    await usdc.connect(agent).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  it("breaching −5% daily cap sidelines the agent AND the next allocate reverts", async () => {
    // Allocate 100 → agent gets 100 USDC; vault has 0.
    await vault.connect(allocator).allocate(agent.address, ethers.parseUnits("100", 6), 1);
    expect(await usdc.balanceOf(agent.address)).to.equal(ethers.parseUnits("100", 6));

    // Agent lost $6 → returns $94 on settle. -6 / 100 deployed = -6% > -5% cap.
    await expect(
      vault.connect(allocator).settle(agent.address, -ethers.parseUnits("6", 6))
    ).to.emit(vault, "AgentSidelined");

    expect(await vault.agentSidelined(agent.address)).to.equal(true);
    expect(await vault.agentAllocation(agent.address)).to.equal(0);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(ethers.parseUnits("94", 6));

    // Subsequent allocate to the sidelined agent reverts.
    await expect(
      vault.connect(allocator).allocate(agent.address, ethers.parseUnits("10", 6), 2)
    ).to.be.revertedWith("agent sidelined");
  });

  it("losing 4% does NOT sideline (under −5% cap)", async () => {
    await vault.connect(allocator).allocate(agent.address, ethers.parseUnits("100", 6), 1);
    await vault.connect(allocator).settle(agent.address, -ethers.parseUnits("4", 6));
    expect(await vault.agentSidelined(agent.address)).to.equal(false);
    // Vault should still accept a new allocation
    await vault.connect(allocator).allocate(agent.address, ethers.parseUnits("10", 6), 2);
    expect(await vault.agentAllocation(agent.address)).to.equal(ethers.parseUnits("10", 6));
  });

  it("admin can unsideline after a sideline", async () => {
    await vault.connect(allocator).allocate(agent.address, ethers.parseUnits("100", 6), 1);
    await vault.connect(allocator).settle(agent.address, -ethers.parseUnits("6", 6));
    expect(await vault.agentSidelined(agent.address)).to.equal(true);

    await vault.connect(admin).unsidelineAgent(agent.address);
    expect(await vault.agentSidelined(agent.address)).to.equal(false);

    // After unsideline, a fresh allocation works again
    await vault.connect(allocator).allocate(agent.address, ethers.parseUnits("10", 6), 2);
    expect(await vault.agentAllocation(agent.address)).to.equal(ethers.parseUnits("10", 6));
  });
});
```

- [ ] **Step 11.2: Run**

```bash
cd apps/contracts && pnpm hardhat test --grep "daily loss cap"
```

Expected: 3 tests passing.

Also run the full suite to confirm no regression:
```bash
pnpm hardhat test
```

Expected: previously 21 + new 3 = 24 tests passing.

- [ ] **Step 11.3: Commit**

```bash
git add apps/contracts/test/DailyLossCap.integration.test.ts
git commit -m "test(vault): integration test for −5% daily loss cap + admin unsideline"
```

---

## Task 12: CCTP recovery script

Operator-run when an agent emits a stuck event. Reads a burn tx hash on either chain, re-fetches the Iris attestation, calls `receiveMessage` on the destination.

**Files:**
- Create: `scripts/cctp-recover.ts`

- [ ] **Step 12.1: Write the script**

```typescript
/**
 * Manual CCTP recovery for a stuck burn.
 *
 * Usage:
 *   pnpm tsx scripts/cctp-recover.ts <agentId> <burnTxHash> [direction]
 *
 *   agentId    hermes | pythia | demeter (selects which PRIVATE_KEY to use)
 *   burnTxHash the tx hash from the failed bridge
 *   direction  arc-to-hl (default) | hl-to-arc
 *
 * The script fetches the burn receipt, extracts the MessageSent log, polls
 * Iris for the attestation, and calls receiveMessage on the destination chain.
 *
 * After success, the operator should also POST {agentId, reason: null} to
 * the allocator's /stuck endpoint to clear the stuck flag.
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const IRIS_API = "https://iris-api-sandbox.circle.com/attestations";

const MT_ABI = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
] as const;

async function pollIris(messageHash: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const resp = await fetch(`${IRIS_API}/${messageHash}`);
    if (resp.ok) {
      const data = await resp.json() as { status: string; attestation?: string };
      console.log(`[recover] attempt ${i + 1}: status=${data.status}`);
      if (data.status === "complete" && data.attestation) return data.attestation;
    } else {
      console.log(`[recover] attempt ${i + 1}: http ${resp.status}`);
    }
  }
  throw new Error("Iris attestation never landed after 10 min");
}

async function main() {
  const [agentId, burnTxHash, dir = "arc-to-hl"] = process.argv.slice(2);
  if (!agentId || !burnTxHash) {
    console.error("Usage: pnpm tsx scripts/cctp-recover.ts <agentId> <burnTxHash> [arc-to-hl|hl-to-arc]");
    process.exit(1);
  }
  const keyEnv = `PRIVATE_KEY_${agentId.toUpperCase()}`;
  const pk = process.env[keyEnv];
  if (!pk) throw new Error(`Missing env ${keyEnv}`);

  const isArcToHl = dir === "arc-to-hl";
  const srcRpc = isArcToHl ? process.env.ARC_RPC_URL! : process.env.DEST_RPC_URL!;
  const dstRpc = isArcToHl ? process.env.DEST_RPC_URL! : process.env.ARC_RPC_URL!;
  const dstTransmitter = isArcToHl
    ? process.env.MESSAGE_TRANSMITTER_DEST!
    : (process.env.MESSAGE_TRANSMITTER_ARC ?? "");
  if (!dstTransmitter) throw new Error("Missing destination MessageTransmitter env");

  const srcProvider = new ethers.JsonRpcProvider(srcRpc);
  const receipt = await srcProvider.getTransactionReceipt(burnTxHash);
  if (!receipt) throw new Error(`Receipt not found for ${burnTxHash} on src chain`);

  const log = (receipt.logs as ethers.Log[]).find(
    l => l.topics[0] === ethers.id("MessageSent(bytes)")
  );
  if (!log) throw new Error("MessageSent log not found in receipt");
  const messageBytes = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], log.data)[0] as string;
  const messageHash = ethers.keccak256(messageBytes);
  console.log(`[recover] burn tx ${burnTxHash}; message hash ${messageHash}`);

  console.log(`[recover] polling Iris...`);
  const attestation = await pollIris(messageHash);
  console.log(`[recover] attestation acquired (${attestation.slice(0, 12)}...)`);

  const dstProvider = new ethers.JsonRpcProvider(dstRpc);
  const dstWallet   = new ethers.Wallet(pk, dstProvider);
  const mt          = new ethers.Contract(dstTransmitter, MT_ABI, dstWallet);
  console.log(`[recover] calling receiveMessage on ${dstTransmitter}...`);
  const mintTx = await mt.receiveMessage(messageBytes, attestation);
  const mintReceipt = await mintTx.wait();
  console.log(`[recover] mint OK: ${mintReceipt!.hash}`);

  console.log(`\nNext: clear the stuck flag with:`);
  console.log(`  curl -X POST ${process.env.ALLOCATOR_URL ?? "http://localhost:3001"}/stuck \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(`    -d '{"agentId":"${agentId}","reason":null}'`);
}

main().catch(err => { console.error("[recover] FAILED:", err); process.exit(1); });
```

- [ ] **Step 12.2: Sanity-test (no live network)**

```bash
pnpm tsx scripts/cctp-recover.ts
```

Expected: exits with the usage message.

- [ ] **Step 12.3: Commit**

```bash
git add scripts/cctp-recover.ts
git commit -m "chore(scripts): add cctp-recover for operator-managed stuck-bridge recovery"
```

---

## Phase 2 done when…

1. `pnpm --filter @themis/contracts hardhat test` is green at **24 passing** (was 21 + 3 from T11).
2. `pnpm --filter @themis/allocator test` is green at **9 passing** (was 8 + 1 from T6).
3. `cd apps/agent-hermes && pnpm exec tsc --noEmit`, same for pythia and demeter, all exit 0.
4. `grep -rn "Math.random\|\* 0.005\|\* 0.004\|cycleYieldUsd" apps/agent-*/src` returns zero matches in settlement code paths. (Pre-existing matches inside data fetching are fine — these formulas refer ONLY to the deleted synthetic PnL.)
5. The operator has run `pnpm tsx scripts/verify-cctp-testnet.ts` successfully at least once and the observed timings/domain IDs are written into `docs/cctp-testnet.md`.
6. `ENABLE_REAL_TRADES=true` 24-hour soak on testnet: each of the three agents completes ≥10 full cycles. Every `Settled` event on the indexer corresponds to either a real USYC `Redeem` event or a real HL position close (verifiable by tx hashes in the agent logs).
7. `scripts/cctp-recover.ts` has been exercised at least once successfully against a deliberately stuck bridge.

---

## Phases 3-5: still deferred

Phase 3 (Onboarding + Reasoning Theater UX), Phase 4 (Deploy), and Phase 5 (Hardening) each get their own task-by-task plan when Phase 2 completes.
