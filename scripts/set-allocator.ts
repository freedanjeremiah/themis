/**
 * Set the allocator address on ThemisVault.
 * Run after deploying contracts if admin != allocator wallet.
 * tsx scripts/set-allocator.ts
 */
import { ethers } from "ethers";
import { ThemisVaultABI } from "@themis/shared/abis";
import * as dotenv from "dotenv";

dotenv.config();

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const provider = new ethers.JsonRpcProvider(requireEnv("ARC_RPC_URL"));
const wallet = new ethers.Wallet(requireEnv("PRIVATE_KEY_ALLOCATOR"), provider);
const vault = new ethers.Contract(
  requireEnv("VAULT_ADDRESS"),
  ThemisVaultABI,
  wallet
);

async function main() {
  console.log("Setting allocator to:", wallet.address);
  const tx = await vault.setAllocator(wallet.address);
  const receipt = await tx.wait();
  if (!receipt) throw new Error("Transaction failed to confirm");
  console.log("✓ Allocator set to:", wallet.address, `(tx: ${receipt.hash})`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
