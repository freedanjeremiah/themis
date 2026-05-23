/**
 * Deploys ThemisVault, ThemisRegistry, and TraceAnchor to Arc testnet.
 * Run: pnpm hardhat run scripts/deploy.ts --network arc
 *
 * After running, paste the printed addresses into .env.
 */
import { ethers } from "hardhat";

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

  // 3. TraceAnchor
  const Anchor = await ethers.getContractFactory("TraceAnchor");
  const anchor = await Anchor.deploy();
  await anchor.waitForDeployment();
  const anchorAddress = await anchor.getAddress();
  console.log("TraceAnchor deployed:", anchorAddress);

  // 4. Register agents in ThemisRegistry
  console.log("\nRegistering agents...");
  let tx = await registry.registerAgent(hermes);
  await tx.wait();
  console.log("  Registered Hermes:", hermes);

  tx = await registry.registerAgent(pythia);
  await tx.wait();
  console.log("  Registered Pythia:", pythia);

  tx = await registry.registerAgent(demeter);
  await tx.wait();
  console.log("  Registered Demeter:", demeter);

  // Print .env lines
  console.log("\n--- Paste into .env ---");
  console.log(`VAULT_ADDRESS=${vaultAddress}`);
  console.log(`NEXT_PUBLIC_VAULT_ADDRESS=${vaultAddress}`);
  console.log(`REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`ANCHOR_ADDRESS=${anchorAddress}`);
  console.log("--- End ---");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
