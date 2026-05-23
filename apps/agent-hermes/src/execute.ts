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
import { placeHlOrder } from "./hl.js";
dotenv.config({ path: "../../.env" });

const ENABLE_REAL_TRADES = process.env.ENABLE_REAL_TRADES === "true";

const IRIS_API = "https://iris-api-sandbox.circle.com/attestations";
const MESSAGE_TRANSMITTER_ABI = [
  { name: "receiveMessage", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "message", type: "bytes" }, { name: "attestation", type: "bytes" }],
    outputs: [{ name: "success", type: "bool" }] },
] as const;

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

async function pollIrisAttestation(messageHash: string): Promise<string | null> {
  for (let attempt = 0; attempt < 20; attempt++) {
    await new Promise(r => setTimeout(r, 5_000));
    try {
      const resp = await fetch(`${IRIS_API}/${messageHash}`);
      if (!resp.ok) continue;
      const data = await resp.json() as { status: string; attestation?: string };
      if (data.status === "complete" && data.attestation) {
        return data.attestation;
      }
      console.log(`[hermes] Iris attestation pending (attempt ${attempt + 1}/20)…`);
    } catch {
      // transient fetch error — retry
    }
  }
  console.warn("[hermes] Iris attestation timed out after 100s");
  return null;
}

/**
 * Convert an EVM address to bytes32 (right-padded with zeros → left zero-padded to 32 bytes).
 * CCTP mintRecipient must be 32 bytes.
 */
function addressToBytes32(address: string): string {
  return "0x" + address.slice(2).toLowerCase().padStart(64, "0");
}

/**
 * Execute a winning Hermes proposal by bridging USDC to Hyperliquid via CCTP.
 * Returns position info when a real trade fills, null otherwise.
 * No-op when ENABLE_REAL_TRADES=false (logs intent only).
 */
export async function executeHermesTrade(
  proposal: AgentProposal,
  allocatedUsd: number
): Promise<{ fillPrice: number | null; coin: string; sizeInCoins: number; szDecimals: number; isBuy: boolean } | null> {
  const amountUsdc6 = BigInt(Math.floor(allocatedUsd * 1_000_000));

  if (!ENABLE_REAL_TRADES) {
    console.log(
      `[hermes] CCTP bridge skipped (ENABLE_REAL_TRADES=false): would burn ${allocatedUsd} USDC on Arc` +
      ` → mint on Hyperliquid (domain ${HYPERLIQUID_CCTP_DOMAIN}) for trade: ${proposal.tradeIdea}`
    );
    return null;
  }

  if (!CCTP_TOKEN_MESSENGER) {
    console.warn("[hermes] CCTP_TOKEN_MESSENGER not set — skipping CCTP bridge");
    return null;
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

  // Extract MessageSent log to get the message bytes and hash
  const messageSentLog = (receipt?.logs as ethers.Log[])?.find(
    (log: ethers.Log) => log.topics[0] === ethers.id("MessageSent(bytes)")
  );
  if (!messageSentLog) {
    console.warn("[hermes] Could not find MessageSent log — attestation skipped");
    return null;
  }

  // The message is in the log data (ABI-encoded bytes)
  const messageBytes = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], messageSentLog.data)[0] as string;
  const messageHash  = ethers.keccak256(messageBytes);

  console.log(`[hermes] Polling Iris for attestation (hash: ${messageHash.slice(0, 12)}…)`);
  const attestation = await pollIrisAttestation(messageHash);
  if (!attestation) return null;

  // Call receiveMessage on destination (Hyperliquid)
  const destRpc = process.env.DEST_RPC_URL;
  const destTransmitter = process.env.MESSAGE_TRANSMITTER_DEST;
  if (!destRpc || !destTransmitter) {
    console.warn("[hermes] DEST_RPC_URL or MESSAGE_TRANSMITTER_DEST not set — mint skipped");
    return null;
  }

  const destProvider = new ethers.JsonRpcProvider(destRpc);
  const destWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, destProvider);
  const transmitter  = new ethers.Contract(destTransmitter, MESSAGE_TRANSMITTER_ABI, destWallet);
  const mintTx = await transmitter.receiveMessage(messageBytes, attestation);
  const mintReceipt = await mintTx.wait();
  console.log(`[hermes] CCTP mint complete on destination (tx: ${mintReceipt?.hash})`);

  // Place perp order on Hyperliquid (non-fatal — bridge already completed)
  try {
    const { orderId, fillPrice, coin, sizeInCoins, szDecimals, isBuy } = await placeHlOrder(
      process.env.PRIVATE_KEY_HERMES!,
      proposal,
      allocatedUsd,
      "hermes"
    );
    if (fillPrice !== null) {
      console.log(`[hermes] HL order filled: avgPx=${fillPrice}`);
      return { fillPrice, coin, sizeInCoins, szDecimals, isBuy };
    } else if (orderId !== null) {
      console.log(`[hermes] HL order resting on book: oid=${orderId}`);
    } else {
      console.warn("[hermes] HL order placement returned no fill/resting — check logs above");
    }
    return null;
  } catch (err) {
    console.warn("[hermes] HL order placement failed (non-fatal):", err);
    return null;
  }
}
