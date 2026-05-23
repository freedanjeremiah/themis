/**
 * Register agent wallets on ThemisRegistry.
 * Run after deploying contracts: tsx scripts/register-agents.ts
 */
import { ethers } from "ethers";
import { ThemisRegistryABI } from "@themis/shared/abis";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env" });

const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY_ALLOCATOR!, provider);
const registry = new ethers.Contract(
  process.env.REGISTRY_ADDRESS!,
  ThemisRegistryABI as unknown[],
  wallet
);

async function main() {
  const agents = [
    { name: "hermes", address: process.env.AGENT_ADDRESS_HERMES! },
    { name: "pythia", address: process.env.AGENT_ADDRESS_PYTHIA! },
    { name: "demeter", address: process.env.AGENT_ADDRESS_DEMETER! },
  ];

  for (const agent of agents) {
    console.log(`Registering ${agent.name} (${agent.address})...`);
    const tx = await registry.registerAgent(agent.address);
    await tx.wait();
    console.log(`✓ Registered ${agent.name}`);
  }

  console.log("\nAll agents registered.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
