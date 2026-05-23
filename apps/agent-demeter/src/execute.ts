/**
 * Execute a Demeter yield rotation: deposit USDC into USYC or Aave on Arc.
 * Gated by ENABLE_REAL_TRADES=true. Off by default for safety.
 *
 * USYC: ERC-4626 vault — deposit(assets, receiver)
 * Aave v3: supply(asset, amount, onBehalfOf, referralCode)
 */
import { ethers } from "ethers";
import { AgentProposal } from "@themis/shared";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const ENABLE_REAL_TRADES = process.env.ENABLE_REAL_TRADES === "true";

const USDC_ADDRESS  = process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
const USYC_ADDRESS  = process.env.USYC_ADDRESS ?? "";
const AAVE_POOL     = process.env.AAVE_POOL_ADDRESS ?? "";

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }] },
] as const;

const USYC_ABI = [
  { name: "deposit", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }],
    outputs: [{ name: "shares", type: "uint256" }] },
] as const;

const AAVE_POOL_ABI = [
  { name: "supply", type: "function", stateMutability: "nonpayable",
    inputs: [
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "onBehalfOf", type: "address" },
      { name: "referralCode", type: "uint16" },
    ],
    outputs: [] },
] as const;

export async function executeDemeterRotation(
  proposal: AgentProposal,
  allocatedUsd: number
): Promise<void> {
  const venue = proposal.venue;
  const amountUsdc6 = BigInt(Math.floor(allocatedUsd * 1_000_000));

  if (!ENABLE_REAL_TRADES) {
    console.log(
      `[demeter] Yield rotation skipped (ENABLE_REAL_TRADES=false): would deposit ${allocatedUsd} USDC` +
      ` into ${venue} for: ${proposal.tradeIdea}`
    );
    return;
  }

  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY_DEMETER!, provider);
  const usdc     = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);

  if (venue === "usyc") {
    if (!USYC_ADDRESS) {
      console.warn("[demeter] USYC_ADDRESS not set — skipping deposit");
      return;
    }
    const approveTx = await usdc.approve(USYC_ADDRESS, amountUsdc6);
    await approveTx.wait();
    const usyc = new ethers.Contract(USYC_ADDRESS, USYC_ABI, wallet);
    const depositTx = await usyc.deposit(amountUsdc6, wallet.address);
    const receipt = await depositTx.wait();
    console.log(`[demeter] USYC deposit confirmed (tx: ${receipt?.hash})`);

  } else if (venue === "aave") {
    if (!AAVE_POOL) {
      console.warn("[demeter] AAVE_POOL_ADDRESS not set — skipping supply");
      return;
    }
    const approveTx = await usdc.approve(AAVE_POOL, amountUsdc6);
    await approveTx.wait();
    const aave = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, wallet);
    const supplyTx = await aave.supply(USDC_ADDRESS, amountUsdc6, wallet.address, 0);
    const receipt = await supplyTx.wait();
    console.log(`[demeter] Aave supply confirmed (tx: ${receipt?.hash})`);

  } else {
    console.warn(`[demeter] Unknown venue: ${venue}`);
  }
}
