# CCTP Testnet Verification + Soak Test Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `.env` for HL testnet, fill the three missing reverse-bridge CCTP vars, write a reverse-direction verify script, then start a real-trades soak test.

**Architecture:** Two env-fix commits tighten the configuration; one new script (`verify-cctp-reverse.ts`) mirrors the existing forward verifier; two operator runs confirm both directions; then `ENABLE_REAL_TRADES=true` starts the soak.

**Tech Stack:** ethers v6, dotenv, Node/pnpm tsx, Circle CCTP V2 Iris sandbox API.

---

## Contract addresses (researched — do not change without re-verifying)

| Variable | Value | Chain |
|---|---|---|
| `CCTP_TOKEN_MESSENGER_HL` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | HyperEVM testnet |
| `MESSAGE_TRANSMITTER_ARC` | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | Arc testnet |
| `USDC_ADDRESS_HL` | `0x2B3370eE501B4a559b57D449569354196457D8Ab` | HyperEVM testnet |

Circle deploys `TokenMessengerV2` and `MessageTransmitterV2` at identical addresses across all testnet chains in a given CCTP V2 deployment. USDC address differs per chain.

---

## File map

| Action | File | What changes |
|---|---|---|
| Modify | `.env` | Switch HL mainnet→testnet; add `HYPERLIQUID_EXCHANGE_URL`; fill 3 reverse-bridge vars |
| Modify | `docs/cctp-testnet.md` | Add known contract addresses; timing rows left for operator to fill |
| Create | `scripts/verify-cctp-reverse.ts` | New HL→Arc verify script |

---

## Task 1: Switch `.env` from HL mainnet → HL testnet

**Files:**
- Modify: `.env`

- [ ] **Step 1: Edit `.env` — replace the five mainnet HL values with testnet equivalents**

Make these exact replacements in `.env`:

```
# Replace:
DEST_RPC_URL=https://rpc.hyperliquid.xyz/evm
HYPERLIQUID_CHAIN_ID=999
MESSAGE_TRANSMITTER_DEST=0x81D40F21F12A8F0E3252Bccb954D722d4c464B64
HYPERLIQUID_API_URL=https://api.hyperliquid.xyz
HYPERLIQUID_INFO_URL=https://api.hyperliquid.xyz/info

# With:
DEST_RPC_URL=https://rpc.hyperliquid-testnet.xyz/evm
HYPERLIQUID_CHAIN_ID=998
MESSAGE_TRANSMITTER_DEST=0xE737e5cEBEEBa77EFe34D4aa090756590b1CE275
HYPERLIQUID_API_URL=https://api.hyperliquid-testnet.xyz
HYPERLIQUID_INFO_URL=https://api.hyperliquid-testnet.xyz/info
```

- [ ] **Step 2: Add the missing `HYPERLIQUID_EXCHANGE_URL` line**

Add after `HYPERLIQUID_INFO_URL`:

```
HYPERLIQUID_EXCHANGE_URL=https://api.hyperliquid-testnet.xyz/exchange
```

- [ ] **Step 3: Verify the five values are correct**

Run:
```
node -e "require('dotenv').config(); const e=process.env; console.log(e.DEST_RPC_URL, e.HYPERLIQUID_CHAIN_ID, e.MESSAGE_TRANSMITTER_DEST, e.HYPERLIQUID_API_URL, e.HYPERLIQUID_EXCHANGE_URL)"
```

Expected output (one line):
```
https://rpc.hyperliquid-testnet.xyz/evm 998 0xE737e5cEBEEBa77EFe34D4aa090756590b1CE275 https://api.hyperliquid-testnet.xyz https://api.hyperliquid-testnet.xyz/exchange
```

- [ ] **Step 4: Commit**

```bash
git add .env
git commit -m "fix(env): switch HL mainnet values to testnet; add HYPERLIQUID_EXCHANGE_URL"
```

---

## Task 2: Fill the three reverse-bridge env vars

**Files:**
- Modify: `.env`

- [ ] **Step 1: Edit `.env` — fill the three blank reverse-bridge vars**

The bottom of `.env` currently has three blank vars. Replace them:

```
# Replace:
CCTP_TOKEN_MESSENGER_HL=
MESSAGE_TRANSMITTER_ARC=
USDC_ADDRESS_HL=

# With:
CCTP_TOKEN_MESSENGER_HL=0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA
MESSAGE_TRANSMITTER_ARC=0xE737e5cEBEEBa77EFe34D4aa090756590b1CE275
USDC_ADDRESS_HL=0x2B3370eE501B4a559b57D449569354196457D8Ab
```

- [ ] **Step 2: Verify all three are non-empty**

Run:
```
node -e "require('dotenv').config(); const e=process.env; console.log(e.CCTP_TOKEN_MESSENGER_HL, e.MESSAGE_TRANSMITTER_ARC, e.USDC_ADDRESS_HL)"
```

Expected:
```
0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA 0xE737e5cEBEEBa77EFe34D4aa090756590b1CE275 0x2B3370eE501B4a559b57D449569354196457D8Ab
```

- [ ] **Step 3: Commit**

```bash
git add .env
git commit -m "fix(env): fill CCTP_TOKEN_MESSENGER_HL, MESSAGE_TRANSMITTER_ARC, USDC_ADDRESS_HL"
```

---

## Task 3: Write `scripts/verify-cctp-reverse.ts`

**Files:**
- Create: `scripts/verify-cctp-reverse.ts`

- [ ] **Step 1: Create the script**

Create `scripts/verify-cctp-reverse.ts` with this exact content:

```typescript
/**
 * One-shot CCTP V2 testnet verifier (reverse): burn $1 USDC on HL testnet, poll Iris
 * sandbox for the attestation, mint on Arc testnet. Run AFTER verify-cctp-testnet.ts
 * so the HL wallet already holds $1 from the forward bridge.
 *
 * Usage:
 *   pnpm tsx scripts/verify-cctp-reverse.ts
 *
 * Required env:
 *   DEST_RPC_URL                    HL testnet RPC
 *   USDC_ADDRESS_HL                 HL-side USDC
 *   CCTP_TOKEN_MESSENGER_HL         HL-side TokenMessenger
 *   ARC_CCTP_DOMAIN                 CCTP destination domain for Arc (26)
 *   ARC_RPC_URL                     Arc testnet RPC
 *   MESSAGE_TRANSMITTER_ARC         Arc-side MessageTransmitter
 *   PRIVATE_KEY_HERMES              wallet with >= $1 testnet USDC on HL
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
      console.log(`[verify-cctp-reverse] attempt ${i + 1}: status=${data.status}`);
      if (data.status === "complete" && data.attestation) return data.attestation;
    } else {
      console.log(`[verify-cctp-reverse] attempt ${i + 1}: http ${resp.status}`);
    }
  }
  throw new Error("Iris attestation timed out after 10 min");
}

async function main() {
  const required = [
    "DEST_RPC_URL", "USDC_ADDRESS_HL", "CCTP_TOKEN_MESSENGER_HL",
    "ARC_CCTP_DOMAIN", "ARC_RPC_URL", "MESSAGE_TRANSMITTER_ARC", "PRIVATE_KEY_HERMES",
  ];
  for (const k of required) if (!process.env[k]) throw new Error(`Missing env: ${k}`);

  const amount = 1_000_000n; // $1.00 USDC (6 decimals)

  const srcProvider = new ethers.JsonRpcProvider(process.env.DEST_RPC_URL!);
  const srcWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, srcProvider);
  console.log(`[verify-cctp-reverse] source wallet (HL): ${srcWallet.address}`);

  const usdc = new ethers.Contract(process.env.USDC_ADDRESS_HL!, ERC20_ABI, srcWallet);
  const balBefore = await usdc.balanceOf(srcWallet.address);
  console.log(`[verify-cctp-reverse] USDC balance on HL testnet: ${Number(balBefore) / 1e6}`);
  if (balBefore < amount) {
    throw new Error("HL wallet needs >= $1 USDC. Run verify-cctp-testnet.ts first to bridge $1 to HL.");
  }

  console.log(`[verify-cctp-reverse] approving HL TokenMessenger...`);
  const ax = await usdc.approve(process.env.CCTP_TOKEN_MESSENGER_HL!, amount);
  await ax.wait();

  const arcDomain = Number(process.env.ARC_CCTP_DOMAIN!);
  console.log(`[verify-cctp-reverse] burning $1 on HL testnet → destDomain ${arcDomain}...`);
  const tm = new ethers.Contract(process.env.CCTP_TOKEN_MESSENGER_HL!, TM_ABI, srcWallet);
  const burnTx = await tm.depositForBurn(
    amount,
    arcDomain,
    addressToBytes32(srcWallet.address),
    process.env.USDC_ADDRESS_HL!,
  );
  const burnStart = Date.now();
  const burnReceipt = await burnTx.wait();
  console.log(`[verify-cctp-reverse] burn tx: ${burnReceipt!.hash}`);

  const msLog = (burnReceipt!.logs as ethers.Log[]).find(
    l => l.topics[0] === ethers.id("MessageSent(bytes)")
  );
  if (!msLog) throw new Error("MessageSent log not found in burn receipt");
  const messageBytes = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], msLog.data)[0] as string;
  const messageHash = ethers.keccak256(messageBytes);
  console.log(`[verify-cctp-reverse] message hash: ${messageHash}`);

  console.log(`[verify-cctp-reverse] polling Iris sandbox...`);
  const attestation = await pollIris(messageHash);
  const irisMs = Date.now() - burnStart;
  console.log(`[verify-cctp-reverse] attestation received in ~${Math.round(irisMs / 1000)}s (${attestation.slice(0, 12)}...)`);

  const dstProvider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const dstWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, dstProvider);
  const mt = new ethers.Contract(process.env.MESSAGE_TRANSMITTER_ARC!, MT_ABI, dstWallet);

  console.log(`[verify-cctp-reverse] receiveMessage on Arc testnet...`);
  const mintTx = await mt.receiveMessage(messageBytes, attestation);
  const mintReceipt = await mintTx.wait();
  const totalMs = Date.now() - burnStart;
  console.log(`[verify-cctp-reverse] mint tx: ${mintReceipt!.hash}`);
  console.log(`[verify-cctp-reverse] Iris latency:    ~${Math.round(irisMs / 1000)}s`);
  console.log(`[verify-cctp-reverse] Total roundtrip: ~${Math.round(totalMs / 1000)}s`);

  console.log(`\n[verify-cctp-reverse] === HL→ARC ROUNDTRIP COMPLETE — env values verified ===`);
}

main().catch(e => { console.error("[verify-cctp-reverse] FAILED:", e); process.exit(1); });
```

- [ ] **Step 2: Verify the script type-checks cleanly**

Run from repo root:
```bash
pnpm tsx --no-run scripts/verify-cctp-reverse.ts
```

If `--no-run` isn't supported by your tsx version, instead do a dry compile:
```bash
cd scripts && npx tsc --noEmit --allowImportingTsExtensions --module NodeNext --moduleResolution NodeNext --target ES2022 verify-cctp-reverse.ts 2>&1 | head -20
```

Expected: no errors (or only "cannot find module dotenv" which is a project-level dependency, not a bug).

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-cctp-reverse.ts
git commit -m "feat(scripts): add verify-cctp-reverse for HL→Arc direction"
```

---

## Task 4: Update `docs/cctp-testnet.md` with known contract values

**Files:**
- Modify: `docs/cctp-testnet.md`

- [ ] **Step 1: Replace the existing "Verified environment values" table**

Open `docs/cctp-testnet.md` and replace the entire `## Verified environment values` section with:

```markdown
## Verified environment values

| Variable | Value | Source |
|---|---|---|
| `ARC_CCTP_DOMAIN` | `26` | Arc testnet domain ID |
| `HYPERLIQUID_CCTP_DOMAIN` | `19` | HyperEVM testnet domain ID |
| `CCTP_TOKEN_MESSENGER` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | Arc testnet TokenMessengerV2 |
| `MESSAGE_TRANSMITTER_DEST` | `0xE737e5cEBEEBa77EFe34D4aa090756590b1CE275` | HyperEVM testnet MessageTransmitterV2 |
| `CCTP_TOKEN_MESSENGER_HL` | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | HyperEVM testnet TokenMessengerV2 |
| `MESSAGE_TRANSMITTER_ARC` | `0xE737e5cEBEEBa77EFe34D4aa090756590b1CE275` | Arc testnet MessageTransmitterV2 |
| `USDC_ADDRESS_HL` | `0x2B3370eE501B4a559b57D449569354196457D8Ab` | HyperEVM testnet USDC |
| Iris sandbox URL | `https://iris-api-sandbox.circle.com/attestations` | Circle CCTP V2 testnet docs |
```

- [ ] **Step 2: Commit**

```bash
git add docs/cctp-testnet.md
git commit -m "docs(cctp): add known contract addresses for both bridge directions"
```

---

## Task 5 (OPERATOR — run manually): Forward verify Arc→HL

> This task burns real testnet USDC. The subagent cannot run it. The operator must run it in a terminal.

- [ ] **Step 1: Run the forward verifier**

```bash
pnpm tsx scripts/verify-cctp-testnet.ts
```

Watch for these log lines in order:
```
[verify-cctp] source wallet: 0xD5B9468c...
[verify-cctp] USDC balance on Arc: <number >= 2>
[verify-cctp] approving TokenMessenger...
[verify-cctp] burning $1 on Arc → destDomain 19...
[verify-cctp] burn tx: 0x...
[verify-cctp] message hash: 0x...
[verify-cctp] polling Iris sandbox...
[verify-cctp] attempt N: status=complete
[verify-cctp] attestation received (0x...)
[verify-cctp] receiveMessage on HL testnet...
[verify-cctp] mint tx: 0x...
[verify-cctp] === ROUNDTRIP COMPLETE — env values verified ===
```

If it fails at `receiveMessage`: check that `MESSAGE_TRANSMITTER_DEST` and `DEST_RPC_URL` are the testnet values (Task 1). If it fails at Iris poll: the burn tx landed but Iris hasn't attested yet — re-run with the burn tx hash via `scripts/cctp-recover.ts`.

- [ ] **Step 2: Note Iris attestation latency**

The script logs `attempt N: status=complete`. Multiply N by 10 to get approximate seconds. Update `docs/cctp-testnet.md` `## Observed timings` section:

```markdown
## Observed timings

- **Arc→HL Iris attestation latency**: ~Xs after burn confirmed  (fill from script output)
- **Arc→HL Total roundtrip (burn → mint)**: ~Xs                  (fill from script output)
- **HL→Arc Iris attestation latency**: _fill after Task 6_
- **HL→Arc Total roundtrip (burn → mint)**: _fill after Task 6_
```

---

## Task 6 (OPERATOR — run manually): Reverse verify HL→Arc

> Run this only after Task 5 completes. The HL wallet receives $1 from the forward bridge, which funds this burn.

- [ ] **Step 1: Run the reverse verifier**

```bash
pnpm tsx scripts/verify-cctp-reverse.ts
```

Watch for these log lines in order:
```
[verify-cctp-reverse] source wallet (HL): 0xD5B9468c...
[verify-cctp-reverse] USDC balance on HL testnet: <number >= 1>
[verify-cctp-reverse] approving HL TokenMessenger...
[verify-cctp-reverse] burning $1 on HL testnet → destDomain 26...
[verify-cctp-reverse] burn tx: 0x...
[verify-cctp-reverse] message hash: 0x...
[verify-cctp-reverse] polling Iris sandbox...
[verify-cctp-reverse] attempt N: status=complete
[verify-cctp-reverse] attestation received in ~Xs (0x...)
[verify-cctp-reverse] receiveMessage on Arc testnet...
[verify-cctp-reverse] mint tx: 0x...
[verify-cctp-reverse] Iris latency:    ~Xs
[verify-cctp-reverse] Total roundtrip: ~Xs
[verify-cctp-reverse] === HL→ARC ROUNDTRIP COMPLETE — env values verified ===
```

- [ ] **Step 2: Update timings in `docs/cctp-testnet.md`**

Fill in the HL→Arc rows from the script's final two log lines, then commit:

```bash
git add docs/cctp-testnet.md
git commit -m "docs(cctp): fill observed Iris latency timings after verify runs"
```

---

## Task 7: Enable real trades and start soak test

**Files:**
- Modify: `.env`

- [ ] **Step 1: Set `ENABLE_REAL_TRADES=true` in `.env`**

Change:
```
ENABLE_REAL_TRADES=false
```
To:
```
ENABLE_REAL_TRADES=true
```

- [ ] **Step 2: Confirm all agents have vault approval**

Each agent wallet must have approved the vault to pull USDC during `settle()`. Run once per agent if not already done:

```bash
pnpm tsx scripts/approve-vault.ts hermes
pnpm tsx scripts/approve-vault.ts pythia
pnpm tsx scripts/approve-vault.ts demeter
```

Expected per run (not yet approved): `[approve-vault] hermes approving vault, tx 0x...` then `[approve-vault] hermes approved.`
Expected per run (already approved): `[approve-vault] hermes 0xD5B946... already has max allowance`

- [ ] **Step 3: Start all services**

From repo root:
```bash
pnpm dev
```

Expected: all five services start (contracts compile first via `predev`), then:
```
[allocator] listening on :3001
[indexer]   listening on :3002
[hermes]    cycle 1 starting...
[pythia]    cycle 1 starting...
[demeter]   cycle 1 starting...
```

- [ ] **Step 4: Monitor for the first full cycle (~20 min)**

Watch allocator logs for a successful `settle` call:
```
[allocator] settled hermes pnl=+NNNN
```

Watch for any `stuck` state:
```
[allocator] hermes marked stuck: <reason>
```

If an agent goes stuck, recover with:
```bash
pnpm tsx scripts/cctp-recover.ts hermes <burnTxHash> hl-to-arc
curl -X POST http://localhost:3001/stuck -H 'content-type: application/json' \
  -d '{"agentId":"hermes","reason":null}'
```

- [ ] **Step 5: Verify ≥ 10 cycles complete**

After ~3h 20min of clean operation, check settled trade counts via the indexer `/agents` endpoint:
```bash
curl http://localhost:3002/agents | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{JSON.parse(d).forEach(a=>console.log(a.agentId+':',a.tradesCompleted))})"
```

Expected output (after ≥ 10 settled cycles each):
```
hermes: 10
pythia: 10
demeter: 10
```

---

## Self-review notes

- Tasks 1–4 and 7 are automatable by a subagent. Tasks 5–6 require the operator (real USDC burns).
- The subagent should stop after Task 4 and prompt the operator to run Tasks 5–6, then resume at Task 7.
- The `approve-vault.ts` calls in Task 7 Step 2 are idempotent — safe to run even if already done.
- The cycle-count query in Task 7 Step 5 assumes the indexer exposes a `/cycles` endpoint — verify this matches `apps/indexer/src/` routes before running.
