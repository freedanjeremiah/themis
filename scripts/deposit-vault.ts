/**
 * Deposit USDC into ThemisVault from each agent wallet so the allocator
 * has capital to work with. Run once before soak test.
 *
 * Usage: pnpm tsx scripts/deposit-vault.ts
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
] as const;
const VAULT_ABI = [
  "function deposit(uint256 amount) external",
  "function totalAssets() view returns (uint256)",
  "function paused() view returns (bool)",
  "function depositedBy(address) view returns (uint256)",
  "function WALLET_CAP() view returns (uint256)",
] as const;

const DEPOSIT_PER_AGENT = 10_000_000n; // $10 each

async function depositFrom(label: string, privateKey: string) {
  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const wallet = new ethers.Wallet(privateKey, provider);
  const usdc = new ethers.Contract(process.env.USDC_ADDRESS!, ERC20_ABI, wallet);
  const vault = new ethers.Contract(process.env.VAULT_ADDRESS!, VAULT_ABI, wallet);

  const [bal, isPaused, alreadyDeposited, walletCap] = await Promise.all([
    usdc.balanceOf(wallet.address),
    vault.paused(),
    vault.depositedBy(wallet.address),
    vault.WALLET_CAP(),
  ]);
  console.log(`[${label}] USDC on Arc: $${Number(bal) / 1e6}, already deposited: $${Number(alreadyDeposited) / 1e6}`);
  if (isPaused) { console.warn(`[${label}] vault is paused, skipping`); return; }

  const remaining = walletCap - alreadyDeposited;
  const amount = remaining < DEPOSIT_PER_AGENT ? remaining : DEPOSIT_PER_AGENT;
  if (amount <= 0n || bal < amount) { console.warn(`[${label}] insufficient balance or cap reached, skipping`); return; }

  console.log(`[${label}] approving vault for $${Number(amount) / 1e6}...`);
  await (await usdc.approve(process.env.VAULT_ADDRESS!, amount)).wait();

  console.log(`[${label}] depositing...`);
  const tx = await vault.deposit(amount);
  const receipt = await tx.wait();
  console.log(`[${label}] deposit tx: ${receipt.hash}`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const vault = new ethers.Contract(process.env.VAULT_ADDRESS!, VAULT_ABI, provider);
  const before = await vault.totalAssets();
  console.log(`Vault totalAssets before: $${Number(before) / 1e6}`);

  await depositFrom("hermes",  process.env.PRIVATE_KEY_HERMES!);
  await depositFrom("pythia",  process.env.PRIVATE_KEY_PYTHIA!);
  await depositFrom("demeter", process.env.PRIVATE_KEY_DEMETER!);

  const after = await vault.totalAssets();
  console.log(`\nVault totalAssets after: $${Number(after) / 1e6}`);
}

main().catch(e => { console.error("FAILED:", e); process.exit(1); });
