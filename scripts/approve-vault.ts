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
