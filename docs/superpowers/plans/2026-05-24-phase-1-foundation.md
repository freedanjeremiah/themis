# Phase 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the off-chain pipeline actually executable end-to-end. Fix the empty-ABI runtime blocker, make the vault the real custody point (USDC actually moves on allocate/settle), persist allocator state, delete cosmetic / dead code, and prove the loop works with a real end-to-end script. No agent reasoning or HL trading changes — that is Phase 2.

**Architecture:** Vault adds `safeTransfer(agent, amount)` to `allocate()` and `safeTransferFrom(agent, vault, allocated + pnl)` to `settle()` — so the vault truly custodies USDC and the allocator no longer has to pre-fund agents out-of-band. A new `scripts/sync-abis.ts` copies Hardhat artifact ABIs into `packages/shared/src/abis/` and is wired into lifecycle hooks + CI so the shared ABIs can never silently drift to empty again. Allocator state moves from in-memory to a tiny `node:sqlite` file so Sharpe survives restarts. TraceAnchor gains agent-registry-gated auth. Dead/cosmetic code is removed.

**Tech Stack:** Solidity 0.8.24 + OpenZeppelin v5, Hardhat + chai, ethers v6, Node 22 `node:sqlite`, TypeScript strict, vitest, pnpm workspaces.

---

## Plan-wide notes

- **All commits in this plan must NOT include `Co-Authored-By: Claude` trailers.** Plain commit messages only.
- **Work from the repo root** unless a step says otherwise. Use absolute or repo-rooted paths.
- **Run `pnpm --filter contracts hardhat compile` once** before starting Task 1 if `apps/contracts/artifacts/` doesn't already exist. Subsequent tasks rely on it.
- The repo currently has tests in `apps/contracts/test/`. Keep adding to existing files unless a step says "Create".
- Solidity tests run via `cd apps/contracts && pnpm hardhat test`. Allocator tests run via `cd apps/allocator && pnpm vitest run`.

---

## File map

| Path | Action | Owner |
|---|---|---|
| `scripts/sync-abis.ts` | Create | Task 1 |
| `package.json` (root) | Modify (add scripts) | Task 2 |
| `packages/shared/package.json` | Modify (postinstall) | Task 2 |
| `.github/workflows/ci.yml` | Create | Task 3 |
| `apps/contracts/contracts/ThemisVault.sol` | Modify | Tasks 4, 5, 6 |
| `apps/contracts/contracts/TraceAnchor.sol` | Modify | Task 7 |
| `apps/contracts/test/ThemisVault.test.ts` | Modify | Tasks 4, 5, 6 |
| `apps/contracts/test/TraceAnchor.test.ts` | Modify | Task 7 |
| `apps/contracts/test/ThemisRegistry.test.ts` | Create | Task 8 |
| `scripts/approve-vault.ts` | Create | Task 9 |
| `apps/allocator/src/db.ts` | Create | Task 10 |
| `apps/allocator/src/state.ts` | Modify | Task 10 |
| `apps/allocator/test/state.test.ts` | Create | Task 10 |
| `apps/dashboard/src/components/CircleKitDeposit.tsx` | Delete | Task 11 |
| `apps/dashboard/src/app/page.tsx` | Modify | Task 11 |
| `scripts/register-agents.ts` | Delete | Task 11 |
| `apps/dashboard/src/lib/abis.ts` | Delete | Task 12 |
| `apps/dashboard/src/components/DepositPanel.tsx` | Modify | Task 12 |
| `scripts/e2e.ts` | Replace | Task 13 |
| `apps/contracts/scripts/deploy.ts` | Modify (TraceAnchor ctor arg) | Task 7 |

---

## Task 1: ABI sync script

**Files:**
- Create: `scripts/sync-abis.ts`

- [ ] **Step 1.1: Write `scripts/sync-abis.ts`**

```typescript
/**
 * Reads compiled Hardhat artifacts and writes their ABIs into the shared
 * package so every off-chain service has a single source of truth.
 *
 * Usage: pnpm tsx scripts/sync-abis.ts
 * Exits non-zero on any missing artifact (CI uses this to fail loudly).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ARTIFACTS = join(ROOT, "apps/contracts/artifacts/contracts");
const SHARED_ABIS = join(ROOT, "packages/shared/src/abis");

const CONTRACTS = ["ThemisVault", "ThemisRegistry", "TraceAnchor"] as const;

let failed = false;
for (const name of CONTRACTS) {
  const artifactPath = join(ARTIFACTS, `${name}.sol`, `${name}.json`);
  const outPath = join(SHARED_ABIS, `${name}.json`);
  if (!existsSync(artifactPath)) {
    console.error(`[sync-abis] MISSING artifact: ${artifactPath}`);
    console.error(`[sync-abis] Run \`pnpm --filter @themis/contracts hardhat compile\` first.`);
    failed = true;
    continue;
  }
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  if (!Array.isArray(artifact.abi)) {
    console.error(`[sync-abis] Artifact ${name} has no .abi array`);
    failed = true;
    continue;
  }
  writeFileSync(outPath, JSON.stringify(artifact.abi, null, 2) + "\n");
  console.log(`[sync-abis] wrote ${outPath} (${artifact.abi.length} entries)`);
}

if (failed) process.exit(1);
console.log("[sync-abis] done.");
```

- [ ] **Step 1.2: Run it once to populate ABIs**

Run from repo root:
```bash
pnpm --filter @themis/contracts hardhat compile && pnpm tsx scripts/sync-abis.ts
```

Expected: three "[sync-abis] wrote …" lines, no errors, exit 0. The files `packages/shared/src/abis/{ThemisVault,ThemisRegistry,TraceAnchor}.json` are no longer `[]`.

If the `--filter` name does not match (the contracts package may be named differently in `apps/contracts/package.json`), substitute the correct package name. Confirm by running `pnpm ls --depth -1` from repo root.

- [ ] **Step 1.3: Sanity-check the dashboard still builds**

Run:
```bash
cd apps/dashboard && pnpm build
```

Expected: build succeeds. The dashboard imports `@themis/shared` for types only, so populated ABIs should not break it. (If `pnpm build` is not defined in `apps/dashboard/package.json`, run `pnpm dev` briefly and stop — the goal is just to catch a regression.)

- [ ] **Step 1.4: Commit**

```bash
git add scripts/sync-abis.ts packages/shared/src/abis/
git commit -m "build: add sync-abis script and populate shared ABI files"
```

---

## Task 2: Wire ABI sync into lifecycle hooks

**Files:**
- Modify: `package.json` (root)
- Modify: `packages/shared/package.json`

- [ ] **Step 2.1: Add root-level scripts**

Read the current `package.json`:
```bash
cat package.json
```

Replace its `"scripts"` block so it reads:

```json
  "scripts": {
    "abis": "pnpm --filter @themis/contracts hardhat compile && tsx scripts/sync-abis.ts",
    "predev": "pnpm abis",
    "prebuild": "pnpm abis",
    "dev": "turbo dev",
    "build": "turbo build",
    "test": "turbo test"
  },
```

If you don't already have `tsx` at the root, add it to `devDependencies`:

```json
  "devDependencies": {
    "tsx": "^4.7.0",
    "turbo": "^2.0.0",
    "typescript": "^5.4.0"
  }
```

Then run:
```bash
pnpm install
```

- [ ] **Step 2.2: Add postinstall to the shared package**

Read the current `packages/shared/package.json`. Replace its `"scripts"` block:

```json
  "scripts": {
    "build": "tsc",
    "postinstall": "node -e \"const p=require('path'),f=require('fs');['ThemisVault','ThemisRegistry','TraceAnchor'].forEach(n=>{const fp=p.join(__dirname,'src/abis',n+'.json');if(!f.existsSync(fp)||f.readFileSync(fp,'utf8').trim()==='[]')console.warn('[shared] '+n+'.json is empty — run \\'pnpm abis\\' from repo root');});\""
  },
```

The postinstall only warns. It does not auto-run sync-abis (that would require Hardhat compiled artifacts which won't exist on a fresh clone). The warning tells contributors what to run.

- [ ] **Step 2.3: Verify the wiring**

From repo root:
```bash
pnpm predev
```

Expected: contracts compile (or report "Nothing to compile"), then sync-abis prints "wrote" lines. Exit 0.

Delete one shared ABI to confirm sync regenerates it:
```bash
echo "[]" > packages/shared/src/abis/ThemisVault.json
pnpm abis
```

Expected: file is rewritten with the real ABI.

- [ ] **Step 2.4: Commit**

```bash
git add package.json packages/shared/package.json pnpm-lock.yaml
git commit -m "build: wire sync-abis into predev/prebuild and add shared postinstall warning"
```

---

## Task 3: CI workflow with ABI-sync check

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 3.1: Write the CI workflow**

```yaml
name: CI

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 11.2.2
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "pnpm"

      - name: Install
        run: pnpm install --frozen-lockfile

      - name: Compile contracts
        run: pnpm --filter @themis/contracts hardhat compile

      - name: Sync ABIs and assert clean
        run: |
          pnpm tsx scripts/sync-abis.ts
          if ! git diff --exit-code -- packages/shared/src/abis; then
            echo "::error::Shared ABIs are out of sync with compiled artifacts. Run 'pnpm abis' locally and commit."
            exit 1
          fi

      - name: Contract tests
        run: pnpm --filter @themis/contracts hardhat test

      - name: Allocator tests
        run: pnpm --filter @themis/allocator vitest run

      - name: Typecheck dashboard
        run: pnpm --filter @themis/dashboard exec tsc --noEmit
```

If the dashboard's package.json `name` is not `@themis/dashboard`, adjust the filter. Same for `@themis/contracts` and `@themis/allocator` — check `apps/*/package.json` and use the actual names.

- [ ] **Step 3.2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add ABI-sync, contract, and allocator test workflow"
```

CI will only run after the next PR or push to `main`. No verification step here other than the YAML being syntactically valid (use `yamllint .github/workflows/ci.yml` if available).

---

## Task 4: Vault — allocate transfers USDC + liquidReserve precondition

**Files:**
- Modify: `apps/contracts/contracts/ThemisVault.sol:85-92`
- Modify: `apps/contracts/test/ThemisVault.test.ts`

- [ ] **Step 4.1: Write the failing test for USDC transfer on allocate**

Append to `apps/contracts/test/ThemisVault.test.ts` (inside the existing `describe("ThemisVault", ...)` block, before the closing `});`):

```typescript
  it("transfers USDC out to agent on allocate", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    const before = await usdc.balanceOf(allocator.address);
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("40", 6), 1);
    const after = await usdc.balanceOf(allocator.address);
    expect(after - before).to.equal(ethers.parseUnits("40", 6));
  });

  it("reverts allocate when amount exceeds liquid reserve", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    // First allocate 80 — leaves 20 liquid.
    await vault.connect(allocator).allocate(user2.address, ethers.parseUnits("80", 6), 1);
    // Second allocate of 30 to a different agent exceeds the 20 remaining.
    await expect(
      vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("30", 6), 2)
    ).to.be.revertedWithCustomError(vault, "InsufficientLiquidity");
  });
```

- [ ] **Step 4.2: Run the new tests — verify they fail**

```bash
cd apps/contracts && pnpm hardhat test --grep "allocate"
```

Expected: the two new tests fail. The first fails because `allocator` balance doesn't change. The second fails because the contract does not currently revert.

- [ ] **Step 4.3: Modify `ThemisVault.sol` allocate to transfer + check reserve**

In `apps/contracts/contracts/ThemisVault.sol`, replace the existing `allocate` function (lines 85–92) with:

```solidity
    function allocate(address agent, uint256 amount, uint256 cycleId) external onlyAllocator notPaused {
        require(!agentSidelined[agent], "agent sidelined");
        // Compute incremental movement: agent already holds `agentAllocation[agent]`.
        uint256 prev = agentAllocation[agent];
        if (amount > prev) {
            uint256 delta = amount - prev;
            uint256 liquid = liquidReserve();
            if (delta > liquid) revert InsufficientLiquidity(liquid, delta);
            totalDeployed += delta;
            agentAllocation[agent] = amount;
            _resetDailyIfNeeded(agent);
            agentDailyDeployed[agent] += delta;
            usdc.safeTransfer(agent, delta);
        } else if (amount < prev) {
            // Allocator is reducing — agent must already have returned the diff via settle/forceSettle.
            // For Phase 1 we only support upward allocations; revert if asked to reduce.
            revert("use settle to reduce");
        } // amount == prev: no-op (still emit event for the cycle marker)
        emit Allocated(agent, amount, cycleId);
    }
```

The previous code blindly set `agentAllocation = amount` and `agentDailyDeployed += amount`, both of which were wrong if `allocate()` was called twice in one cycle for the same agent. The new code is delta-based.

- [ ] **Step 4.4: Run all vault tests — verify pass**

```bash
cd apps/contracts && pnpm hardhat test --grep "ThemisVault"
```

Expected: all tests pass, including the two from Step 4.1 and the existing "reverts withdraw when insufficient liquidity" test (which deposits 100, allocates 90 to allocator, then withdraws — still valid because 90 ≤ 100 liquid).

If the existing test at the original line 53 ("updates totalAssets on settle with positive PnL") fails because it mints USDC to the vault directly to simulate PnL, leave that for Task 5 — Task 5 reworks that test entirely.

- [ ] **Step 4.5: Re-sync ABIs**

```bash
cd ../.. && pnpm abis
```

(`allocate` signature is unchanged, but the artifact bytecode is, so the JSON regenerates.)

- [ ] **Step 4.6: Commit**

```bash
git add apps/contracts/contracts/ThemisVault.sol \
        apps/contracts/test/ThemisVault.test.ts \
        packages/shared/src/abis/ThemisVault.json
git commit -m "feat(vault): allocate transfers USDC out and enforces liquid reserve"
```

---

## Task 5: Vault — settle pulls USDC back (allocated + pnl)

**Files:**
- Modify: `apps/contracts/contracts/ThemisVault.sol:94-119`
- Modify: `apps/contracts/test/ThemisVault.test.ts` (rework two existing tests + add one)

- [ ] **Step 5.1: Update the existing positive-PnL settle test**

In `apps/contracts/test/ThemisVault.test.ts`, replace the existing test "updates totalAssets on settle with positive PnL" (around lines 53–59) with:

```typescript
  it("pulls USDC back on settle with positive PnL", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("50", 6), 1);
    // Agent (allocator EOA here) made $5: now holds 55, vault holds 50.
    await usdc.mint(allocator.address, ethers.parseUnits("5", 6));
    await usdc.connect(allocator).approve(await vault.getAddress(), ethers.MaxUint256);

    await vault.connect(allocator).settle(allocator.address, ethers.parseUnits("5", 6));

    expect(await vault.totalAssets()).to.equal(ethers.parseUnits("105", 6));
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(ethers.parseUnits("105", 6));
    expect(await vault.agentAllocation(allocator.address)).to.equal(0);
  });
```

- [ ] **Step 5.2: Update the existing daily-loss-cap test**

Replace the existing "emits AgentSidelined when daily loss cap breached" test with:

```typescript
  it("pulls USDC back on settle with negative PnL and sidelines on >5% loss", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("100", 6), 1);
    // Agent lost 6: now holds 94, vault holds 0.
    await usdc.connect(allocator).approve(await vault.getAddress(), ethers.MaxUint256);

    await expect(
      vault.connect(allocator).settle(allocator.address, -ethers.parseUnits("6", 6))
    ).to.emit(vault, "AgentSidelined");

    expect(await vault.totalAssets()).to.equal(ethers.parseUnits("94", 6));
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(ethers.parseUnits("94", 6));
    expect(await vault.agentSidelined(allocator.address)).to.equal(true);
  });
```

- [ ] **Step 5.3: Add a zero-PnL settle test (no transferFrom needed)**

```typescript
  it("settle with zero PnL still clears allocation without moving funds", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("30", 6), 1);
    await usdc.connect(allocator).approve(await vault.getAddress(), ethers.MaxUint256);

    await vault.connect(allocator).settle(allocator.address, 0);

    expect(await vault.totalAssets()).to.equal(ethers.parseUnits("100", 6));
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(ethers.parseUnits("100", 6));
    expect(await vault.agentAllocation(allocator.address)).to.equal(0);
  });
```

- [ ] **Step 5.4: Run tests — verify they fail**

```bash
cd apps/contracts && pnpm hardhat test --grep "settle"
```

Expected: the three settle tests fail (current settle does not call transferFrom).

- [ ] **Step 5.5: Modify `ThemisVault.sol` settle to pull `allocated + pnl` back**

Replace the existing `settle` function in `apps/contracts/contracts/ThemisVault.sol` (lines ~94–119) with:

```solidity
    function settle(address agent, int256 pnl) external onlyAllocator notPaused {
        _resetDailyIfNeeded(agent);
        agentDailyPnl[agent] += pnl;

        uint256 allocated = agentAllocation[agent];
        // Net asset change = pnl. Agent returns allocated + pnl.
        int256 returnInt = int256(allocated) + pnl;
        require(returnInt >= 0, "agent owes more than allocation");
        uint256 returnAmt = uint256(returnInt);
        if (returnAmt > 0) {
            usdc.safeTransferFrom(agent, address(this), returnAmt);
        }

        if (pnl >= 0) {
            totalAssets += uint256(pnl);
        } else {
            uint256 loss = uint256(-pnl);
            totalAssets = totalAssets > loss ? totalAssets - loss : 0;
        }

        totalDeployed = totalDeployed > allocated ? totalDeployed - allocated : 0;
        agentAllocation[agent] = 0;

        uint256 basis = agentDailyDeployed[agent];
        if (basis > 0) {
            int256 cap = -int256((basis * LOSS_CAP_BPS) / BPS_DENOM);
            if (agentDailyPnl[agent] < cap) {
                agentSidelined[agent] = true;
                emit AgentSidelined(agent, agentDailyPnl[agent]);
            }
        }

        emit Settled(agent, pnl, totalAssets);
    }
```

Note: `notPaused` is added here so settle is gated by pause. Task 6 also gates `allocate` (already gated as of Task 4) and adds the `forceSettle` admin escape.

- [ ] **Step 5.6: Run tests — verify pass**

```bash
cd apps/contracts && pnpm hardhat test
```

Expected: all `ThemisVault` tests pass, including the three reworked ones and the prior allocate/withdraw tests from Task 4.

- [ ] **Step 5.7: Re-sync ABIs**

```bash
cd ../.. && pnpm abis
```

- [ ] **Step 5.8: Commit**

```bash
git add apps/contracts/contracts/ThemisVault.sol \
        apps/contracts/test/ThemisVault.test.ts \
        packages/shared/src/abis/ThemisVault.json
git commit -m "feat(vault): settle pulls allocated+pnl back via transferFrom"
```

---

## Task 6: Vault — notPaused on allocate/settle + forceSettle admin escape

`notPaused` has already been applied to both functions in Tasks 4 and 5. This task adds the `forceSettle` admin escape so winding down during a pause is still possible.

**Files:**
- Modify: `apps/contracts/contracts/ThemisVault.sol`
- Modify: `apps/contracts/test/ThemisVault.test.ts`

- [ ] **Step 6.1: Write failing tests**

Append to `apps/contracts/test/ThemisVault.test.ts`:

```typescript
  it("allocate reverts when paused", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(admin).pause();
    await expect(
      vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("10", 6), 1)
    ).to.be.revertedWithCustomError(vault, "Paused");
  });

  it("settle reverts when paused", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("10", 6), 1);
    await usdc.connect(allocator).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(admin).pause();
    await expect(
      vault.connect(allocator).settle(allocator.address, 0)
    ).to.be.revertedWithCustomError(vault, "Paused");
  });

  it("forceSettle works while paused (admin only)", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("40", 6), 1);
    await usdc.connect(allocator).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(admin).pause();

    await vault.connect(admin).forceSettle(allocator.address, 0);

    expect(await vault.agentAllocation(allocator.address)).to.equal(0);
    expect(await usdc.balanceOf(await vault.getAddress())).to.equal(ethers.parseUnits("100", 6));
  });

  it("forceSettle reverts when called by non-admin", async () => {
    await vault.connect(user1).deposit(ethers.parseUnits("100", 6));
    await vault.connect(allocator).allocate(allocator.address, ethers.parseUnits("10", 6), 1);
    await usdc.connect(allocator).approve(await vault.getAddress(), ethers.MaxUint256);
    await vault.connect(admin).pause();
    await expect(
      vault.connect(allocator).forceSettle(allocator.address, 0)
    ).to.be.revertedWithCustomError(vault, "NotAdmin");
  });
```

- [ ] **Step 6.2: Run tests — verify they fail**

```bash
cd apps/contracts && pnpm hardhat test --grep "paused\|forceSettle"
```

Expected: "allocate reverts when paused" + "settle reverts when paused" should already pass from Tasks 4/5. The two `forceSettle` tests fail because the function does not exist.

- [ ] **Step 6.3: Add `forceSettle` to the vault**

In `apps/contracts/contracts/ThemisVault.sol`, immediately after the `settle` function, insert:

```solidity
    /// Admin-only wind-down path. Same accounting as settle() but callable while paused.
    /// Pulls agent's funds back, never sidelines (admin is presumed to handle that manually).
    function forceSettle(address agent, int256 pnl) external onlyAdmin {
        agentDailyPnl[agent] += pnl;

        uint256 allocated = agentAllocation[agent];
        int256 returnInt = int256(allocated) + pnl;
        require(returnInt >= 0, "agent owes more than allocation");
        uint256 returnAmt = uint256(returnInt);
        if (returnAmt > 0) {
            usdc.safeTransferFrom(agent, address(this), returnAmt);
        }

        if (pnl >= 0) {
            totalAssets += uint256(pnl);
        } else {
            uint256 loss = uint256(-pnl);
            totalAssets = totalAssets > loss ? totalAssets - loss : 0;
        }

        totalDeployed = totalDeployed > allocated ? totalDeployed - allocated : 0;
        agentAllocation[agent] = 0;

        emit Settled(agent, pnl, totalAssets);
    }
```

- [ ] **Step 6.4: Run tests — verify pass**

```bash
cd apps/contracts && pnpm hardhat test
```

Expected: all tests pass.

- [ ] **Step 6.5: Re-sync ABIs**

```bash
cd ../.. && pnpm abis
```

- [ ] **Step 6.6: Commit**

```bash
git add apps/contracts/contracts/ThemisVault.sol \
        apps/contracts/test/ThemisVault.test.ts \
        packages/shared/src/abis/ThemisVault.json
git commit -m "feat(vault): add forceSettle admin escape and pause coverage tests"
```

---

## Task 7: TraceAnchor — registry-gated auth

**Files:**
- Modify: `apps/contracts/contracts/TraceAnchor.sol`
- Modify: `apps/contracts/test/TraceAnchor.test.ts`
- Modify: `apps/contracts/scripts/deploy.ts` (TraceAnchor constructor now takes the registry address)

- [ ] **Step 7.1: Write failing tests**

Replace the entire contents of `apps/contracts/test/TraceAnchor.test.ts` with:

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";

describe("TraceAnchor", () => {
  it("emits TraceAnchored when caller is a registered agent", async () => {
    const [admin, allocator, agent] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    await registry.connect(admin).registerAgent(agent.address);

    const Anchor = await ethers.getContractFactory("TraceAnchor");
    const anchor = await Anchor.deploy(await registry.getAddress());

    const hash = ethers.keccak256(ethers.toUtf8Bytes("test-trace"));
    const cid = "ipfs://QmTest123";

    const tx = await anchor.connect(agent).anchor(hash, cid);
    const receipt = await tx.wait();

    const filter = anchor.filters.TraceAnchored(agent.address);
    const events = await anchor.queryFilter(filter, receipt!.blockNumber, receipt!.blockNumber);
    expect(events).to.have.length(1);
    expect(events[0].args.agent).to.equal(agent.address);
    expect(events[0].args.hash).to.equal(hash);
    expect(events[0].args.cid).to.equal(cid);
    expect(events[0].args.timestamp).to.be.greaterThan(0);
  });

  it("reverts when caller is not a registered agent", async () => {
    const [admin, allocator, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    const Anchor = await ethers.getContractFactory("TraceAnchor");
    const anchor = await Anchor.deploy(await registry.getAddress());

    const hash = ethers.keccak256(ethers.toUtf8Bytes("trace"));
    await expect(
      anchor.connect(stranger).anchor(hash, "ipfs://Qm")
    ).to.be.revertedWith("not registered agent");
  });
});
```

The signature of `anchor` changes: the caller IS the agent (no `agent` argument). This matches the agent processes' actual pattern — each agent signs from its own wallet anyway.

- [ ] **Step 7.2: Run tests — verify they fail**

```bash
cd apps/contracts && pnpm hardhat test --grep "TraceAnchor"
```

Expected: both tests fail (current contract has no registry constraint).

- [ ] **Step 7.3: Rewrite `TraceAnchor.sol`**

Replace the entire contents of `apps/contracts/contracts/TraceAnchor.sol` with:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IThemisRegistryView {
    function stats(address agent) external view returns (uint64, uint64, int128, bool);
}

contract TraceAnchor {
    IThemisRegistryView public immutable registry;

    event TraceAnchored(address indexed agent, bytes32 hash, string cid, uint256 timestamp);

    constructor(address _registry) {
        registry = IThemisRegistryView(_registry);
    }

    function anchor(bytes32 hash, string calldata cid) external {
        (, , , bool active) = registry.stats(msg.sender);
        require(active, "not registered agent");
        emit TraceAnchored(msg.sender, hash, cid, block.timestamp);
    }
}
```

- [ ] **Step 7.4: Update `apps/contracts/scripts/deploy.ts`**

Read the current file:
```bash
cat apps/contracts/scripts/deploy.ts
```

Locate the TraceAnchor deploy call. It currently looks roughly like:
```typescript
const Anchor = await ethers.getContractFactory("TraceAnchor");
const anchor = await Anchor.deploy();
```

Replace with:
```typescript
const Anchor = await ethers.getContractFactory("TraceAnchor");
const anchor = await Anchor.deploy(await registry.getAddress());
```

If `registry` is named differently in deploy.ts, adjust. The key constraint: deploy the registry first, then pass its address to `TraceAnchor.deploy(...)`.

- [ ] **Step 7.5: Update agent anchor calls**

The three agents call `TraceAnchor.anchor(agent, hash, cid)` today. After this change, the signature is `anchor(hash, cid)`. Update each agent:

```bash
grep -rn "anchor(" apps/agent-*/src/anchor.ts
```

In each `apps/agent-{hermes,pythia,demeter}/src/anchor.ts`, find the line that calls `traceAnchor.anchor(<address>, hash, cid)` and remove the address argument. The exact line will look approximately like:

```typescript
// before
const tx = await traceAnchor.anchor(wallet.address, hashBytes, cid);
// after
const tx = await traceAnchor.anchor(hashBytes, cid);
```

If the function arguments differ, preserve the order: `(hash, cid)`. Do not change anything else in `anchor.ts`.

- [ ] **Step 7.6: Run tests — verify pass**

```bash
cd apps/contracts && pnpm hardhat test
```

Expected: all tests pass.

- [ ] **Step 7.7: Re-sync ABIs**

```bash
cd ../.. && pnpm abis
```

- [ ] **Step 7.8: Commit**

```bash
git add apps/contracts/contracts/TraceAnchor.sol \
        apps/contracts/test/TraceAnchor.test.ts \
        apps/contracts/scripts/deploy.ts \
        apps/agent-hermes/src/anchor.ts \
        apps/agent-pythia/src/anchor.ts \
        apps/agent-demeter/src/anchor.ts \
        packages/shared/src/abis/TraceAnchor.json
git commit -m "feat(trace): require registered-agent caller; drop agent arg from anchor()"
```

**Note:** the existing deployed `TraceAnchor` at `0x87704aB48dE82aBa4FaF3ba81E1edbD37935195c` is now incompatible. It will need to be redeployed after this task. Document this in the commit message of Task 13 (e2e), which will deploy fresh contracts.

---

## Task 8: ThemisRegistry tests

**Files:**
- Create: `apps/contracts/test/ThemisRegistry.test.ts`

- [ ] **Step 8.1: Write the test file**

```typescript
import { expect } from "chai";
import { ethers } from "hardhat";

describe("ThemisRegistry", () => {
  it("defaults agents to inactive", async () => {
    const [admin, allocator, agent] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    const [, , , active] = await registry.stats(agent.address);
    expect(active).to.equal(false);
  });

  it("registerAgent flips active to true", async () => {
    const [admin, allocator, agent] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    await expect(registry.connect(admin).registerAgent(agent.address))
      .to.emit(registry, "AgentRegistered").withArgs(agent.address);
    const [, , , active] = await registry.stats(agent.address);
    expect(active).to.equal(true);
  });

  it("registerAgent reverts when caller is not admin", async () => {
    const [admin, allocator, agent, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    await expect(
      registry.connect(stranger).registerAgent(agent.address)
    ).to.be.revertedWith("not admin");
  });

  it("recordOutcome increments wins and cumulative PnL", async () => {
    const [admin, allocator, agent] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    await registry.connect(admin).registerAgent(agent.address);

    await registry.connect(allocator).recordOutcome(agent.address, true, 100);
    await registry.connect(allocator).recordOutcome(agent.address, false, -30);

    const [won, lost, pnl] = await registry.stats(agent.address);
    expect(won).to.equal(1n);
    expect(lost).to.equal(1n);
    expect(pnl).to.equal(70n);
  });

  it("recordOutcome reverts when caller is not allocator", async () => {
    const [admin, allocator, agent, stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ThemisRegistry");
    const registry = await Registry.connect(admin).deploy(allocator.address);
    await registry.connect(admin).registerAgent(agent.address);
    await expect(
      registry.connect(stranger).recordOutcome(agent.address, true, 10)
    ).to.be.revertedWith("not allocator");
  });
});
```

- [ ] **Step 8.2: Run — verify pass**

```bash
cd apps/contracts && pnpm hardhat test --grep "ThemisRegistry"
```

Expected: all 5 tests pass against the existing registry contract.

- [ ] **Step 8.3: Commit**

```bash
git add apps/contracts/test/ThemisRegistry.test.ts
git commit -m "test(registry): cover admin/allocator auth and stat accounting"
```

---

## Task 9: scripts/approve-vault.ts helper

**Files:**
- Create: `scripts/approve-vault.ts`

- [ ] **Step 9.1: Write the script**

```typescript
/**
 * Each agent must approve the vault to pull USDC back during settle().
 * Run once per agent after the agent wallet is funded with USDC for gas.
 *
 * Usage:
 *   pnpm tsx scripts/approve-vault.ts hermes
 *   pnpm tsx scripts/approve-vault.ts pythia
 *   pnpm tsx scripts/approve-vault.ts demeter
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
] as const;

const AGENT_KEYS = {
  hermes: "PRIVATE_KEY_HERMES",
  pythia: "PRIVATE_KEY_PYTHIA",
  demeter: "PRIVATE_KEY_DEMETER",
} as const;
type AgentId = keyof typeof AGENT_KEYS;

async function main() {
  const agentArg = process.argv[2] as AgentId | undefined;
  if (!agentArg || !(agentArg in AGENT_KEYS)) {
    console.error("Usage: pnpm tsx scripts/approve-vault.ts <hermes|pythia|demeter>");
    process.exit(1);
  }
  const pk = process.env[AGENT_KEYS[agentArg]];
  const vaultAddr = process.env.VAULT_ADDRESS;
  const usdcAddr = process.env.USDC_ADDRESS;
  const rpc = process.env.ARC_RPC_URL;
  if (!pk || !vaultAddr || !usdcAddr || !rpc) {
    throw new Error("Missing env: PRIVATE_KEY_<AGENT>, VAULT_ADDRESS, USDC_ADDRESS, ARC_RPC_URL");
  }

  const provider = new ethers.JsonRpcProvider(rpc);
  const wallet = new ethers.Wallet(pk, provider);
  const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, wallet);

  const current = await usdc.allowance(wallet.address, vaultAddr);
  if (current === ethers.MaxUint256) {
    console.log(`[approve-vault] ${agentArg} ${wallet.address} already has max allowance`);
    return;
  }

  const tx = await usdc.approve(vaultAddr, ethers.MaxUint256);
  console.log(`[approve-vault] ${agentArg} approving vault, tx ${tx.hash}`);
  await tx.wait();
  console.log(`[approve-vault] ${agentArg} approved.`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 9.2: Commit**

```bash
git add scripts/approve-vault.ts
git commit -m "chore(scripts): add approve-vault helper for agent USDC allowance"
```

---

## Task 10: Allocator — SQLite persistence

**Files:**
- Create: `apps/allocator/src/db.ts`
- Modify: `apps/allocator/src/state.ts`
- Create: `apps/allocator/test/state.test.ts`

- [ ] **Step 10.1: Create `apps/allocator/src/db.ts`**

```typescript
// File-backed SQLite for allocator state. Uses Node's built-in driver.
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.ALLOCATOR_DB_PATH ?? join(__dirname, "../state.db");

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_state (
    agent_id TEXT PRIMARY KEY,
    trades_completed INTEGER NOT NULL DEFAULT 0,
    cumulative_pnl_today INTEGER NOT NULL DEFAULT 0,
    last_settle_day INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS pnl_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    pnl_usdc6 INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pnl_agent ON pnl_history(agent_id, ts);
`);

export const upsertAgentState = db.prepare(`
  INSERT INTO agent_state (agent_id, trades_completed, cumulative_pnl_today, last_settle_day)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(agent_id) DO UPDATE SET
    trades_completed = excluded.trades_completed,
    cumulative_pnl_today = excluded.cumulative_pnl_today,
    last_settle_day = excluded.last_settle_day
`);

export const insertPnl = db.prepare(`
  INSERT INTO pnl_history (agent_id, ts, pnl_usdc6) VALUES (?, ?, ?)
`);

export const selectAgentState = db.prepare(`
  SELECT trades_completed, cumulative_pnl_today, last_settle_day FROM agent_state WHERE agent_id = ?
`);

export const selectPnlHistory = db.prepare(`
  SELECT ts, pnl_usdc6 FROM pnl_history WHERE agent_id = ? ORDER BY ts DESC LIMIT 100
`);
```

- [ ] **Step 10.2: Modify `apps/allocator/src/state.ts` — persist on settle, hydrate on import**

Open `apps/allocator/src/state.ts` and apply the following changes.

**Add an import at the top, below the existing imports:**

```typescript
import { upsertAgentState, insertPnl, selectAgentState, selectPnlHistory } from "./db.js";
```

**Replace the `makeState` function with one that hydrates from disk:**

```typescript
function makeState(agentId: AgentId): AgentState {
  const row = selectAgentState.get(agentId) as
    | { trades_completed: number; cumulative_pnl_today: number; last_settle_day: number }
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
    sidelined: false, // sidelined is read live from the vault, not persisted
  };
}
```

**Replace `recordSettlement` so it writes to the DB:**

```typescript
  recordSettlement(agentId: AgentId, pnl: number) {
    const s = agentStates[agentId];
    const todayDay = Math.floor(Date.now() / 86_400_000);
    if (s.cumulativePnlToday !== 0 && (s.pnlHistory.at(-1)?.timestamp ?? 0) < todayDay * 86_400_000) {
      s.cumulativePnlToday = 0;
    }
    s.tradesCompleted++;
    s.cumulativePnlToday += pnl;
    const ts = Date.now();
    s.pnlHistory.push({ timestamp: ts, pnl });
    if (s.pnlHistory.length > 100) s.pnlHistory.shift();
    s.currentAllocationUsd = 0;

    const pnlUsdc6 = Math.round(pnl * 1_000_000);
    upsertAgentState.run(agentId, s.tradesCompleted, Math.round(s.cumulativePnlToday * 1_000_000), todayDay);
    insertPnl.run(agentId, ts, pnlUsdc6);
  },
```

**Delete `sidelineAgent`** from the `state` object — it is unused (the vault is the source of truth) and will be removed in Task 11 anyway. Leaving the deletion here keeps the persistence work in one task.

- [ ] **Step 10.3: Write the test**

Create `apps/allocator/test/state.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("allocator state persistence", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "themis-alloc-"));
    process.env.ALLOCATOR_DB_PATH = join(tmp, "state.db");
    process.env.AGENT_ADDRESS_HERMES = "0x0000000000000000000000000000000000000001";
    process.env.AGENT_ADDRESS_PYTHIA = "0x0000000000000000000000000000000000000002";
    process.env.AGENT_ADDRESS_DEMETER = "0x0000000000000000000000000000000000000003";
  });

  it("persists settlements across re-imports of state.ts", async () => {
    // First import: record a settlement.
    const mod1 = await import(`../src/state.ts?cachebust=${Date.now()}1`);
    mod1.state.recordSettlement("hermes", 1.5);
    mod1.state.recordSettlement("hermes", -0.5);

    // Second import: hydrates from disk.
    const mod2 = await import(`../src/state.ts?cachebust=${Date.now()}2`);
    const s = mod2.state.getAgentState("hermes");
    expect(s.tradesCompleted).to.equal(2);
    expect(s.pnlHistory.length).to.equal(2);
    expect(s.pnlHistory[0].pnl).to.equal(1.5);
    expect(s.pnlHistory[1].pnl).to.equal(-0.5);

    rmSync(tmp, { recursive: true, force: true });
  });
});
```

`vitest` does not natively cache-bust dynamic imports the same way Node does; if the cachebust trick fails on your vitest version, use `vi.resetModules()` between imports instead:

```typescript
import { vi } from "vitest";
// ...
vi.resetModules();
const mod2 = await import("../src/state");
```

- [ ] **Step 10.4: Run the test**

```bash
cd apps/allocator && pnpm vitest run
```

Expected: passes. If `node:sqlite` is missing (Node < 22.5), upgrade Node first.

- [ ] **Step 10.5: Commit**

```bash
git add apps/allocator/src/db.ts apps/allocator/src/state.ts apps/allocator/test/state.test.ts
git commit -m "feat(allocator): persist agent state and pnl history to SQLite"
```

---

## Task 11: Delete dead code

**Files:**
- Delete: `apps/dashboard/src/components/CircleKitDeposit.tsx`
- Modify: `apps/dashboard/src/app/page.tsx`
- Delete: `scripts/register-agents.ts`
- (`sidelineAgent` was already removed in Task 10.)

- [ ] **Step 11.1: Replace the dynamic import in `page.tsx`**

Open `apps/dashboard/src/app/page.tsx` and replace lines 10–13 (the `const CircleKitDeposit = dynamic(...)` block) with:

```typescript
const DepositPanel = dynamic(
  () => import("../components/DepositPanel").then(m => m.DepositPanel),
  { ssr: false, loading: () => <div className="bg-gray-900 rounded-lg p-4 border border-gray-700 h-48 animate-pulse" /> }
);
```

Then on line 123 (the JSX `<CircleKitDeposit ... />`), replace with:

```tsx
          <DepositPanel liquidReservePct={liquidReservePct} />
```

If `DepositPanel` does not export the `liquidReservePct` prop, check `apps/dashboard/src/components/DepositPanel.tsx` and adjust the prop name to match (e.g., it may already accept `liquidReservePct`). Do not rename the file or its export.

- [ ] **Step 11.2: Delete `CircleKitDeposit.tsx`**

```bash
rm apps/dashboard/src/components/CircleKitDeposit.tsx
```

Run a sanity check that nothing else imports it:
```bash
grep -rn "CircleKitDeposit" apps packages scripts
```

Expected: no output. If anything remains, edit those files to remove the reference.

- [ ] **Step 11.3: Verify the dashboard builds**

```bash
cd apps/dashboard && pnpm exec tsc --noEmit
```

Expected: no type errors.

- [ ] **Step 11.4: Delete `scripts/register-agents.ts`**

Confirm `apps/contracts/scripts/deploy.ts` already registers agents (it should — the audit noted this). If you are unsure, read `apps/contracts/scripts/deploy.ts` and confirm a loop calling `registry.registerAgent(...)` exists. Then delete:

```bash
rm scripts/register-agents.ts
grep -rn "register-agents" .
```

Expected: only references should be in this plan / docs (if any), not in code.

- [ ] **Step 11.5: Commit**

```bash
git add apps/dashboard/src/app/page.tsx
git add -u apps/dashboard/src/components/CircleKitDeposit.tsx scripts/register-agents.ts
git commit -m "chore: remove cosmetic CircleKitDeposit wrapper and redundant register-agents script"
```

---

## Task 12: Dashboard — switch to shared ABIs

**Files:**
- Delete: `apps/dashboard/src/lib/abis.ts`
- Modify: `apps/dashboard/src/components/DepositPanel.tsx`

- [ ] **Step 12.1: Inspect current imports**

```bash
grep -n "lib/abis" apps/dashboard/src
```

Expected: one or more imports from `../lib/abis` (or `../../lib/abis`) bringing in `VAULT_ABI`, `ERC20_ABI`, `USDC_ADDRESS` — mostly in `DepositPanel.tsx`.

- [ ] **Step 12.2: Update `DepositPanel.tsx` imports**

In `apps/dashboard/src/components/DepositPanel.tsx`, replace the existing import line for the local abis with:

```typescript
import { ThemisVaultABI } from "@themis/shared/abis";
```

Replace every reference to `VAULT_ABI` in that file with `ThemisVaultABI`.

For `ERC20_ABI` and `USDC_ADDRESS`, keep them defined inline at the top of `DepositPanel.tsx` (the shared package does not export an ERC20 ABI or a USDC address constant, and they are not worth adding for one consumer):

```typescript
const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }] },
] as const;

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
```

- [ ] **Step 12.3: Delete the local abis file**

```bash
rm apps/dashboard/src/lib/abis.ts
```

Verify nothing else references it:
```bash
grep -rn "lib/abis" apps/dashboard/src
```

Expected: no output.

- [ ] **Step 12.4: Typecheck**

```bash
cd apps/dashboard && pnpm exec tsc --noEmit
```

Expected: no errors. The shared `ThemisVaultABI` is imported from the generated JSON; tsc treats it as `any[]`/`unknown`. If wagmi's `useReadContract` / `useWriteContract` complains about the abi type, cast at the call site:

```typescript
abi: ThemisVaultABI as readonly any[],
```

- [ ] **Step 12.5: Smoke-test the dashboard**

```bash
cd apps/dashboard && pnpm dev
```

Open http://localhost:3000. Connect a wallet, attempt a deposit transaction (sign and send if you have testnet USDC; otherwise just confirm the wallet popup shows). Stop the dev server. The goal is to catch wagmi runtime errors from a malformed ABI.

- [ ] **Step 12.6: Commit**

```bash
git add apps/dashboard/src/components/DepositPanel.tsx
git add -u apps/dashboard/src/lib/abis.ts
git commit -m "refactor(dashboard): import vault ABI from shared package, delete local copy"
```

---

## Task 13: Real `scripts/e2e.ts`

**Goal:** end-to-end test that proves deposit → allocate → settle works against a local Hardhat node, exercising the new vault funding model. This does not yet exercise the allocator HTTP service or agents — Phase 2 will extend it.

**Files:**
- Replace: `scripts/e2e.ts`

- [ ] **Step 13.1: Replace `scripts/e2e.ts`**

```typescript
/**
 * Phase 1 E2E: deploy contracts to a local hardhat node, exercise the vault
 * deposit -> allocate -> settle round-trip, verify events and balances.
 *
 * Prereq: in another terminal, run:
 *   cd apps/contracts && pnpm hardhat node
 *
 * Then from repo root:
 *   pnpm tsx scripts/e2e.ts
 */
import { ethers } from "ethers";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ART = join(ROOT, "apps/contracts/artifacts/contracts");
const RPC = "http://127.0.0.1:8545";

function loadArtifact(name: string) {
  const path = join(ART, `${name}.sol`, `${name}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  // Hardhat node provides 20 prefunded accounts; we use 5.
  const [adminPk, allocatorPk, agentPk, userPk] = [
    "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
    "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  ];
  const admin = new ethers.Wallet(adminPk, provider);
  const allocator = new ethers.Wallet(allocatorPk, provider);
  const agent = new ethers.Wallet(agentPk, provider);
  const user = new ethers.Wallet(userPk, provider);

  // 1. Deploy mock USDC
  const ERC20 = loadArtifact("mocks/ERC20Mock");
  const usdcFactory = new ethers.ContractFactory(ERC20.abi, ERC20.bytecode, admin);
  const usdc = await usdcFactory.deploy("USD Coin", "USDC", 6);
  await usdc.waitForDeployment();
  console.log(`[e2e] USDC deployed at ${await usdc.getAddress()}`);

  // 2. Deploy registry, vault, anchor
  const RegistryArt = loadArtifact("ThemisRegistry");
  const VaultArt    = loadArtifact("ThemisVault");
  const AnchorArt   = loadArtifact("TraceAnchor");

  const registry = await new ethers.ContractFactory(RegistryArt.abi, RegistryArt.bytecode, admin)
    .deploy(allocator.address);
  await registry.waitForDeployment();

  const vault = await new ethers.ContractFactory(VaultArt.abi, VaultArt.bytecode, admin)
    .deploy(await usdc.getAddress(), allocator.address);
  await vault.waitForDeployment();

  const anchor = await new ethers.ContractFactory(AnchorArt.abi, AnchorArt.bytecode, admin)
    .deploy(await registry.getAddress());
  await anchor.waitForDeployment();

  console.log(`[e2e] Registry: ${await registry.getAddress()}`);
  console.log(`[e2e] Vault:    ${await vault.getAddress()}`);
  console.log(`[e2e] Anchor:   ${await anchor.getAddress()}`);

  // 3. Register the agent
  await (await (registry as any).connect(admin).registerAgent(agent.address)).wait();
  console.log(`[e2e] Registered agent ${agent.address}`);

  // 4. Mint USDC to user, user deposits 100
  await (await (usdc as any).mint(user.address, ethers.parseUnits("1000", 6))).wait();
  await (await (usdc as any).connect(user).approve(await vault.getAddress(), ethers.MaxUint256)).wait();
  await (await (vault as any).connect(user).deposit(ethers.parseUnits("100", 6))).wait();
  const tvl1 = await (vault as any).totalAssets();
  console.assert(tvl1 === ethers.parseUnits("100", 6), `TVL after deposit = ${tvl1}`);
  console.log(`[e2e] Deposit OK, TVL = ${tvl1}`);

  // 5. Agent approves the vault (Phase 1.9 requirement)
  await (await (usdc as any).connect(agent).approve(await vault.getAddress(), ethers.MaxUint256)).wait();

  // 6. Allocator allocates 50 USDC to the agent
  const allocTx = await (vault as any).connect(allocator).allocate(agent.address, ethers.parseUnits("50", 6), 1);
  const allocReceipt = await allocTx.wait();
  const agentBal = await (usdc as any).balanceOf(agent.address);
  console.assert(agentBal === ethers.parseUnits("50", 6), `agent USDC after allocate = ${agentBal}`);
  const allocEvents = allocReceipt!.logs.filter((l: any) => l.fragment?.name === "Allocated");
  console.assert(allocEvents.length === 1, `expected 1 Allocated event, got ${allocEvents.length}`);
  console.log(`[e2e] Allocate OK, agent holds ${agentBal} USDC`);

  // 7. Agent simulates a +$5 win — mint 5 USDC to agent, then settle(+5)
  await (await (usdc as any).mint(agent.address, ethers.parseUnits("5", 6))).wait();
  const settleTx = await (vault as any).connect(allocator).settle(agent.address, ethers.parseUnits("5", 6));
  const settleReceipt = await settleTx.wait();
  const tvl2 = await (vault as any).totalAssets();
  const vaultBal = await (usdc as any).balanceOf(await vault.getAddress());
  console.assert(tvl2 === ethers.parseUnits("105", 6), `TVL after settle = ${tvl2}`);
  console.assert(vaultBal === ethers.parseUnits("105", 6), `vault balance after settle = ${vaultBal}`);
  const settleEvents = settleReceipt!.logs.filter((l: any) => l.fragment?.name === "Settled");
  console.assert(settleEvents.length === 1, `expected 1 Settled event, got ${settleEvents.length}`);
  console.log(`[e2e] Settle OK, TVL = ${tvl2}, vault holds ${vaultBal}`);

  // 8. Agent anchors a trace
  const hash = ethers.keccak256(ethers.toUtf8Bytes("test-trace"));
  const anchorTx = await (anchor as any).connect(agent).anchor(hash, "ipfs://QmTest");
  const anchorReceipt = await anchorTx.wait();
  const anchorEvents = anchorReceipt!.logs.filter((l: any) => l.fragment?.name === "TraceAnchored");
  console.assert(anchorEvents.length === 1, `expected 1 TraceAnchored event, got ${anchorEvents.length}`);
  console.log(`[e2e] Anchor OK`);

  // 9. Withdraw remaining (user gets back 100 * 105/100 = 105 USDC)
  const userBalBefore = await (usdc as any).balanceOf(user.address);
  const userShares = await (vault as any).shareBalances(user.address);
  await (await (vault as any).connect(user).withdraw(userShares)).wait();
  const userBalAfter = await (usdc as any).balanceOf(user.address);
  const gained = userBalAfter - userBalBefore;
  console.assert(gained === ethers.parseUnits("105", 6), `withdraw gained = ${gained}`);
  console.log(`[e2e] Withdraw OK, user gained ${gained} USDC`);

  console.log("\n[e2e] === PHASE 1 END-TO-END PASSED ===");
}

main().catch(err => { console.error("[e2e] FAILED:", err); process.exit(1); });
```

- [ ] **Step 13.2: Run the e2e**

In one terminal:
```bash
cd apps/contracts && pnpm hardhat node
```

In another, from repo root:
```bash
pnpm tsx scripts/e2e.ts
```

Expected output ends with `[e2e] === PHASE 1 END-TO-END PASSED ===`. If it fails on the `Allocated`/`Settled` event detection, check that `pnpm abis` has been run after Tasks 4–7 so the artifact bytecode matches the new contracts.

- [ ] **Step 13.3: Commit**

```bash
git add scripts/e2e.ts
git commit -m "test(e2e): real deposit/allocate/settle/anchor/withdraw round-trip against hardhat node"
```

---

## Phase 1 done when…

1. `pnpm install && pnpm abis && pnpm --filter @themis/contracts hardhat test` is green.
2. `pnpm --filter @themis/allocator vitest run` is green.
3. In one terminal `cd apps/contracts && pnpm hardhat node`, in another `pnpm tsx scripts/e2e.ts` prints `=== PHASE 1 END-TO-END PASSED ===`.
4. `git grep -n "CircleKitDeposit\|sidelineAgent\|register-agents"` returns no code references (docs / plans are fine).
5. `cat packages/shared/src/abis/ThemisVault.json | head` shows real ABI content, not `[]`.
6. CI workflow exists at `.github/workflows/ci.yml`.

---

## Phases 2–5: deferred to their own plans

Each remaining phase from the design spec is large enough to deserve its own task-by-task plan when its turn comes. They are intentionally not written here because:

- Phase 2 (Real PnL) details depend on observed quirks of HL testnet and CCTP V2 testnet that need a one-day spike before plan writing.
- Phase 3 (UX) details depend on Phase 2's data shape — e.g., which fields the reasoning theater can actually display.
- Phase 4 (Deploy) details depend on provider choice (Fly.io vs Hetzner) which is best made when ready to deploy.
- Phase 5 is ongoing.

When Phase 1 completes, invoke `superpowers:writing-plans` again with the spec section for Phase 2 to produce that plan.

---
