/**
 * Deploys ThemisVault, ThemisRegistry, and TraceAnchor (fresh, current ABI) to
 * Arc testnet, registers the three agents, and writes the resulting addresses
 * into .env and apps/dashboard/.env.local automatically.
 *
 * Run: cd apps/contracts && pnpm hardhat run ../../scripts/deploy.ts --network arc
 */
import { ethers } from "hardhat";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(__dirname, "..");

/** Upsert KEY=value lines in an env file: replace existing keys, append missing ones. */
function upsertEnv(filePath: string, kv: Record<string, string>): void {
  const lines = existsSync(filePath) ? readFileSync(filePath, "utf8").replace(/\n$/, "").split("\n") : [];
  for (const [key, value] of Object.entries(kv)) {
    const idx = lines.findIndex(l => l.replace(/^#\s*/, "").startsWith(`${key}=`));
    if (idx >= 0) lines[idx] = `${key}=${value}`;
    else lines.push(`${key}=${value}`);
  }
  writeFileSync(filePath, lines.join("\n") + "\n");
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);

  const usdc = process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
  const allocator = process.env.PRIVATE_KEY_ALLOCATOR
    ? new ethers.Wallet(process.env.PRIVATE_KEY_ALLOCATOR).address
    : deployer.address;

  const hermes = process.env.AGENT_ADDRESS_HERMES;
  const pythia  = process.env.AGENT_ADDRESS_PYTHIA;
  const demeter = process.env.AGENT_ADDRESS_DEMETER;

  if (!hermes || !pythia || !demeter) {
    throw new Error(
      "Set AGENT_ADDRESS_HERMES, AGENT_ADDRESS_PYTHIA, AGENT_ADDRESS_DEMETER in .env first.\n" +
      "Run: pnpm tsx scripts/create-wallets.ts"
    );
  }

  console.log("USDC:", usdc);
  console.log("Allocator:", allocator);
  console.log("Agents:", hermes, pythia, demeter);
  console.log();

  // 1. ThemisVault
  const Vault = await ethers.getContractFactory("ThemisVault");
  const vault = await Vault.deploy(usdc, allocator);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("ThemisVault deployed:", vaultAddress);

  // 2. ThemisRegistry
  const Registry = await ethers.getContractFactory("ThemisRegistry");
  const registry = await Registry.deploy(allocator);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("ThemisRegistry deployed:", registryAddress);

  // 3. TraceAnchor (registry-gated, current ABI)
  const Anchor = await ethers.getContractFactory("TraceAnchor");
  const anchor = await Anchor.deploy(await registry.getAddress());
  await anchor.waitForDeployment();
  const anchorAddress = await anchor.getAddress();
  console.log("TraceAnchor deployed:", anchorAddress);

  // 4. Register agents in ThemisRegistry
  console.log("\nRegistering agents...");
  for (const [name, addr] of [["Hermes", hermes], ["Pythia", pythia], ["Demeter", demeter]] as const) {
    const tx = await registry.registerAgent(addr);
    await tx.wait();
    console.log(`  Registered ${name}: ${addr}`);
  }

  // 5. Write addresses into .env and apps/dashboard/.env.local
  const rootEnv = join(REPO_ROOT, ".env");
  upsertEnv(rootEnv, {
    VAULT_ADDRESS: vaultAddress,
    NEXT_PUBLIC_VAULT_ADDRESS: vaultAddress,
    REGISTRY_ADDRESS: registryAddress,
    ANCHOR_ADDRESS: anchorAddress,
  });
  console.log(`\nWrote addresses to ${rootEnv}`);

  const dashEnv = join(REPO_ROOT, "apps/dashboard/.env.local");
  upsertEnv(dashEnv, { NEXT_PUBLIC_VAULT_ADDRESS: vaultAddress });
  console.log(`Wrote NEXT_PUBLIC_VAULT_ADDRESS to ${dashEnv}`);

  console.log("\nDeploy complete. Next: pnpm tsx scripts/preflight.ts");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
