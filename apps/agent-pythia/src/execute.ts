/**
 * Execute a Pythia trade: bridge USDC from Arc to Hyperliquid via CCTP.
 * Gated by ENABLE_REAL_TRADES=true. Off by default for safety.
 */
import { ethers } from "ethers";
import { AgentProposal } from "@themis/shared";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const ENABLE_REAL_TRADES = process.env.ENABLE_REAL_TRADES === "true";

const CCTP_TOKEN_MESSENGER_ABI = [
  {
    name: "depositForBurn",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
    ],
    outputs: [{ name: "nonce", type: "uint64" }],
  },
] as const;

const ERC20_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const USDC_ADDRESS         = process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
const CCTP_TOKEN_MESSENGER = process.env.CCTP_TOKEN_MESSENGER ?? "";
const HYPERLIQUID_CCTP_DOMAIN = Number(process.env.HYPERLIQUID_CCTP_DOMAIN ?? "0");

function addressToBytes32(address: string): string {
  return "0x" + address.slice(2).toLowerCase().padStart(64, "0");
}

export async function executePythiaTrade(
  proposal: AgentProposal,
  allocatedUsd: number
): Promise<void> {
  const amountUsdc6 = BigInt(Math.floor(allocatedUsd * 1_000_000));

  if (!ENABLE_REAL_TRADES) {
    console.log(
      `[pythia] CCTP bridge skipped (ENABLE_REAL_TRADES=false): would burn ${allocatedUsd} USDC on Arc` +
      ` → mint on Hyperliquid (domain ${HYPERLIQUID_CCTP_DOMAIN}) for: ${proposal.tradeIdea}`
    );
    return;
  }

  if (!CCTP_TOKEN_MESSENGER) {
    console.warn("[pythia] CCTP_TOKEN_MESSENGER not set — skipping CCTP bridge");
    return;
  }

  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY_PYTHIA!, provider);

  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
  const approveTx = await usdc.approve(CCTP_TOKEN_MESSENGER, amountUsdc6);
  await approveTx.wait();
  console.log(`[pythia] USDC approved to TokenMessenger (${allocatedUsd} USDC)`);

  const messenger = new ethers.Contract(CCTP_TOKEN_MESSENGER, CCTP_TOKEN_MESSENGER_ABI, wallet);
  const mintRecipient = addressToBytes32(wallet.address);
  const burnTx = await messenger.depositForBurn(
    amountUsdc6,
    HYPERLIQUID_CCTP_DOMAIN,
    mintRecipient,
    USDC_ADDRESS
  );
  const receipt = await burnTx.wait();
  console.log(`[pythia] CCTP depositForBurn confirmed (tx: ${receipt?.hash})`);
}
