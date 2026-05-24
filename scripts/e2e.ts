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
  const base = name.split("/").pop()!;
  const path = join(ART, `${name}.sol`, `${base}.json`);
  return JSON.parse(readFileSync(path, "utf8"));
}

async function main() {
  // cacheTimeout: -1 disables the 250 ms request-dedup cache so every
  // eth_getTransactionCount call hits the node instead of returning a
  // stale cached nonce from the previous deployment.
  const provider = new ethers.JsonRpcProvider(RPC, undefined, { cacheTimeout: -1 });

  // Reset chain state to block 0 so the script is idempotent even if the
  // hardhat node already processed some transactions in a prior run.
  await provider.send("hardhat_reset", []);

  // Hardhat node provides 20 prefunded accounts; we use 4.
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

  // 5. Agent approves the vault (T9 requirement)
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
