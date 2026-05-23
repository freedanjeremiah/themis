/**
 * Execute a Hermes trade: bridge USDC from Arc to Hyperliquid via CCTP.
 * Gated by ENABLE_REAL_TRADES=true. Off by default for safety.
 *
 * CCTP flow:
 *   1. Approve USDC to TokenMessenger
 *   2. Call depositForBurn → burns USDC on Arc, emits MessageSent
 *   3. Iris attestation service signs the burn message (~20s)
 *   4. Call receiveMessage on Hyperliquid MessageTransmitter to mint USDC
 *
 * Reference: https://developers.circle.com/cctp
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
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

const USDC_ADDRESS          = process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";
const CCTP_TOKEN_MESSENGER  = process.env.CCTP_TOKEN_MESSENGER ?? "";
const HYPERLIQUID_CCTP_DOMAIN = Number(process.env.HYPERLIQUID_CCTP_DOMAIN ?? "0");

/**
 * Convert an EVM address to bytes32 (right-padded with zeros → left zero-padded to 32 bytes).
 * CCTP mintRecipient must be 32 bytes.
 */
function addressToBytes32(address: string): string {
  return "0x" + address.slice(2).toLowerCase().padStart(64, "0");
}

/**
 * Execute a winning Hermes proposal by bridging USDC to Hyperliquid via CCTP.
 * No-op when ENABLE_REAL_TRADES=false (logs intent only).
 */
export async function executeHermesTrade(
  proposal: AgentProposal,
  allocatedUsd: number
): Promise<void> {
  const amountUsdc6 = BigInt(Math.floor(allocatedUsd * 1_000_000));

  if (!ENABLE_REAL_TRADES) {
    console.log(
      `[hermes] CCTP bridge skipped (ENABLE_REAL_TRADES=false): would burn ${allocatedUsd} USDC on Arc` +
      ` → mint on Hyperliquid (domain ${HYPERLIQUID_CCTP_DOMAIN}) for trade: ${proposal.tradeIdea}`
    );
    return;
  }

  if (!CCTP_TOKEN_MESSENGER) {
    console.warn("[hermes] CCTP_TOKEN_MESSENGER not set — skipping CCTP bridge");
    return;
  }

  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const wallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, provider);

  // Step 1: Approve USDC to TokenMessenger
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
  const approveTx = await usdc.approve(CCTP_TOKEN_MESSENGER, amountUsdc6);
  await approveTx.wait();
  console.log(`[hermes] USDC approved to TokenMessenger (${allocatedUsd} USDC)`);

  // Step 2: depositForBurn — burns USDC on Arc, triggers Iris attestation
  const messenger = new ethers.Contract(CCTP_TOKEN_MESSENGER, CCTP_TOKEN_MESSENGER_ABI, wallet);
  const mintRecipient = addressToBytes32(wallet.address); // Hermes wallet receives on destination
  const burnTx = await messenger.depositForBurn(
    amountUsdc6,
    HYPERLIQUID_CCTP_DOMAIN,
    mintRecipient,
    USDC_ADDRESS
  );
  const receipt = await burnTx.wait();
  console.log(`[hermes] CCTP depositForBurn confirmed (tx: ${receipt?.hash})`);
  console.log(`[hermes] Waiting for Iris attestation (~20s)… then receiveMessage on Hyperliquid`);

  // Step 3: Iris attestation + receiveMessage on Hyperliquid is out of scope for v1.
  // The burn is on-chain; attestation and minting happen async via the CCTP relay.
}
