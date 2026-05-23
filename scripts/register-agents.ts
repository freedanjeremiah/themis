/**
 * Register agent wallets on ThemisRegistry.
 * Run after deploying contracts: tsx scripts/register-agents.ts
 */
import { ethers } from "ethers";
import { ThemisRegistryABI } from "@themis/shared/abis";
import * as dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const provider = new ethers.JsonRpcProvider(requireEnv("ARC_RPC_URL"));
const wallet = new ethers.Wallet(requireEnv("PRIVATE_KEY_ALLOCATOR"), provider);
const registry = new ethers.Contract(
  requireEnv("REGISTRY_ADDRESS"),
  ThemisRegistryABI,
  wallet
);

async function main() {
  const agents = [
    { name: "hermes", address: requireEnv("AGENT_ADDRESS_HERMES") },
    { name: "pythia", address: requireEnv("AGENT_ADDRESS_PYTHIA") },
    { name: "demeter", address: requireEnv("AGENT_ADDRESS_DEMETER") },
  ];

  for (const agent of agents) {
    console.log(`Registering ${agent.name} (${agent.address})...`);
    const tx = await registry.registerAgent(agent.address);
    const receipt = await tx.wait();
    if (!receipt) throw new Error(`Transaction for ${agent.name} failed to confirm`);
    console.log(`✓ Registered ${agent.name} (tx: ${receipt.hash})`);
  }

  console.log("\nAll agents registered.");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
