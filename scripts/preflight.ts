/**
 * Pre-flight validation for the real Arc-testnet path. Run this BEFORE starting
 * the agents/allocator — it catches every misconfiguration that left agents
 * "stuck on cycle 1" during soak testing:
 *   - missing env
 *   - agent AGENT_ADDRESS_* not matching PRIVATE_KEY_* (indexer silently drops events)
 *   - contracts not deployed at the configured addresses
 *   - agents not registered in the registry (anchor() + scoring fail)
 *   - vault.allocator() not matching PRIVATE_KEY_ALLOCATOR (allocate() reverts)
 *   - agents haven't approve()d the vault (settle() reverts)
 *   - no Arc gas in the agent/allocator wallets
 *
 * Usage: pnpm tsx scripts/preflight.ts
 * Exits non-zero if any hard check fails.
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const ARC_CHAIN_ID = 5042002n;

const VAULT_ABI = [
  "function allocator() view returns (address)",
  "function agentSidelined(address) view returns (bool)",
] as const;
const REGISTRY_ABI = [
  "function stats(address) view returns (uint64,uint64,int128,bool)",
] as const;
const ERC20_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
] as const;

type Status = "PASS" | "WARN" | "FAIL";
const results: { name: string; status: Status; detail: string }[] = [];
function check(name: string, status: Status, detail = "") {
  results.push({ name, status, detail });
}

const AGENTS = ["hermes", "pythia", "demeter"] as const;

function reqEnv(key: string): string | null {
  const v = process.env[key];
  if (!v || v.trim() === "" || v.includes("...") || v.startsWith("0x...")) return null;
  return v;
}

async function main() {
  // 1. Required env presence
  const required = [
    "ARC_RPC_URL", "USDC_ADDRESS", "VAULT_ADDRESS", "REGISTRY_ADDRESS", "ANCHOR_ADDRESS",
    "PRIVATE_KEY_ALLOCATOR", "PRIVATE_KEY_HERMES", "PRIVATE_KEY_PYTHIA", "PRIVATE_KEY_DEMETER",
    "AGENT_ADDRESS_HERMES", "AGENT_ADDRESS_PYTHIA", "AGENT_ADDRESS_DEMETER",
    "ANTHROPIC_API_KEY",
  ];
  const missing = required.filter(k => !reqEnv(k));
  if (missing.length) {
    check("Required env", "FAIL", `missing/placeholder: ${missing.join(", ")}`);
    // Can't do anything else without env — print and bail.
    return report();
  }
  check("Required env", "PASS", `${required.length} keys present`);

  // Soft env
  check("PINATA_JWT", reqEnv("PINATA_JWT") ? "PASS" : "WARN", reqEnv("PINATA_JWT") ? "set" : "missing → traces anchor as hash:// only");
  check("TWITTER_BEARER_TOKEN", reqEnv("TWITTER_BEARER_TOKEN") ? "PASS" : "WARN", reqEnv("TWITTER_BEARER_TOKEN") ? "set" : "missing → Pythia uses RSS/cache");
  check("ENABLE_REAL_TRADES", "PASS", process.env.ENABLE_REAL_TRADES === "true" ? "true (live venue calls)" : "false (dry-run, logs intent only)");

  // 2. RPC reachable + chain id
  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  let net;
  try {
    net = await provider.getNetwork();
    check("Arc RPC + chainId", net.chainId === ARC_CHAIN_ID ? "PASS" : "FAIL",
      `chainId ${net.chainId} (expected ${ARC_CHAIN_ID})`);
  } catch (e) {
    check("Arc RPC + chainId", "FAIL", `unreachable: ${(e as Error).message.slice(0, 60)}`);
    return report();
  }

  const vaultAddr = process.env.VAULT_ADDRESS!;
  const registryAddr = process.env.REGISTRY_ADDRESS!;
  const anchorAddr = process.env.ANCHOR_ADDRESS!;
  const usdcAddr = process.env.USDC_ADDRESS!;

  // 3. Contracts have code
  for (const [label, addr] of [["Vault", vaultAddr], ["Registry", registryAddr], ["Anchor", anchorAddr]] as const) {
    const code = await provider.getCode(addr);
    check(`${label} deployed`, code && code !== "0x" ? "PASS" : "FAIL",
      code && code !== "0x" ? addr : `no code at ${addr}`);
  }

  // 4. vault.allocator() matches PRIVATE_KEY_ALLOCATOR
  const vault = new ethers.Contract(vaultAddr, VAULT_ABI, provider);
  const allocatorWallet = new ethers.Wallet(process.env.PRIVATE_KEY_ALLOCATOR!);
  try {
    const onchainAllocator: string = await vault.allocator();
    check("Vault allocator wiring",
      onchainAllocator.toLowerCase() === allocatorWallet.address.toLowerCase() ? "PASS" : "FAIL",
      onchainAllocator.toLowerCase() === allocatorWallet.address.toLowerCase()
        ? "matches PRIVATE_KEY_ALLOCATOR"
        : `vault.allocator()=${onchainAllocator} ≠ ${allocatorWallet.address} — allocate() will revert NotAllocator`);
  } catch (e) {
    check("Vault allocator wiring", "FAIL", `read failed: ${(e as Error).message.slice(0, 50)}`);
  }

  // 5. Allocator gas
  const allocGas = await provider.getBalance(allocatorWallet.address);
  check("Allocator gas (Arc USDC)", allocGas > 0n ? "PASS" : "FAIL",
    `${ethers.formatEther(allocGas)} (raw ${allocGas})${allocGas > 0n ? "" : " — fund allocator for gas"}`);

  // 6. Per-agent: address↔key match, registration, approval, gas, sidelined
  const registry = new ethers.Contract(registryAddr, REGISTRY_ABI, provider);
  const usdc = new ethers.Contract(usdcAddr, ERC20_ABI, provider);
  for (const agent of AGENTS) {
    const pk = process.env[`PRIVATE_KEY_${agent.toUpperCase()}`]!;
    const declaredAddr = process.env[`AGENT_ADDRESS_${agent.toUpperCase()}`]!;
    const derived = new ethers.Wallet(pk).address;

    // address ↔ key match (footgun: indexer maps by AGENT_ADDRESS_*; mismatch drops all events)
    check(`${agent}: addr↔key`,
      derived.toLowerCase() === declaredAddr.toLowerCase() ? "PASS" : "FAIL",
      derived.toLowerCase() === declaredAddr.toLowerCase()
        ? derived
        : `AGENT_ADDRESS_${agent.toUpperCase()}=${declaredAddr} ≠ key-derived ${derived}`);

    // registered?
    try {
      const [, , , active] = await registry.stats(derived);
      check(`${agent}: registered`, active ? "PASS" : "FAIL",
        active ? "active in registry" : "NOT registered — anchor() reverts, never scored. Run deploy.ts (registers agents).");
    } catch (e) {
      check(`${agent}: registered`, "FAIL", `registry read failed: ${(e as Error).message.slice(0, 40)}`);
    }

    // approved vault?
    try {
      const allowance: bigint = await usdc.allowance(derived, vaultAddr);
      check(`${agent}: vault approval`, allowance > 0n ? "PASS" : "FAIL",
        allowance > 0n ? "approved" : "no allowance — settle() reverts. Run: pnpm tsx scripts/approve-vault.ts " + agent);
    } catch (e) {
      check(`${agent}: vault approval`, "WARN", `allowance read failed: ${(e as Error).message.slice(0, 40)}`);
    }

    // gas
    const gas = await provider.getBalance(derived);
    check(`${agent}: Arc gas`, gas > 0n ? "PASS" : "FAIL",
      `${ethers.formatEther(gas)} (raw ${gas})${gas > 0n ? "" : " — fund for gas"}`);

    // sidelined?
    try {
      const sidelined: boolean = await vault.agentSidelined(derived);
      if (sidelined) check(`${agent}: sidelined`, "WARN", "agent is sidelined on-chain — admin must unsidelineAgent()");
    } catch { /* ignore */ }
  }

  report();
}

function report() {
  console.log("\n=== Themis preflight ===");
  const pad = Math.max(...results.map(r => r.name.length));
  for (const r of results) {
    const icon = r.status === "PASS" ? "✓" : r.status === "WARN" ? "!" : "✗";
    console.log(`  ${icon} ${r.name.padEnd(pad)}  ${r.detail}`);
  }
  const fails = results.filter(r => r.status === "FAIL").length;
  const warns = results.filter(r => r.status === "WARN").length;
  console.log(`\n${fails} fail, ${warns} warn, ${results.filter(r => r.status === "PASS").length} pass`);
  if (fails > 0) {
    console.log("\nPreflight FAILED — fix the ✗ items before bring-up.");
    process.exit(1);
  }
  console.log("\nPreflight PASSED — safe to start agents.");
}

main().catch(err => { console.error(err); process.exit(1); });
