/**
 * Bidirectional CCTP V2 bridging for Hermes.
 *
 * `bridgeArcToHl(amountUsd6)`: burns USDC on Arc, polls Iris, mints on HL testnet.
 * `bridgeHlToArc(amountUsd6)`: burns USDC on HL testnet, polls Iris, mints on Arc.
 *
 * Both return the burn tx hash so the caller can recover stuck bridges
 * via scripts/cctp-recover.ts.
 */
import { ethers } from "ethers";
import { ATTESTATION_TIMEOUT_MS } from "@themis/shared";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const IRIS_API = "https://iris-api-sandbox.circle.com/attestations";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
] as const;
const TM_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64 nonce)",
] as const;
const MT_ABI = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
] as const;

const USDC_ADDRESS               = process.env.USDC_ADDRESS!;
const ARC_TOKEN_MESSENGER        = process.env.CCTP_TOKEN_MESSENGER!;
const ARC_MESSAGE_TRANSMITTER    = process.env.MESSAGE_TRANSMITTER_ARC ?? "";
const HL_TOKEN_MESSENGER         = process.env.CCTP_TOKEN_MESSENGER_HL ?? "";
const HL_MESSAGE_TRANSMITTER     = process.env.MESSAGE_TRANSMITTER_DEST!;
const ARC_CCTP_DOMAIN            = Number(process.env.ARC_CCTP_DOMAIN ?? "26");
const HYPERLIQUID_CCTP_DOMAIN    = Number(process.env.HYPERLIQUID_CCTP_DOMAIN ?? "19");

function addressToBytes32(addr: string): string {
  return "0x" + addr.slice(2).toLowerCase().padStart(64, "0");
}

async function pollIris(messageHash: string, tag: string): Promise<string | null> {
  const start = Date.now();
  let attempt = 0;
  while (Date.now() - start < ATTESTATION_TIMEOUT_MS) {
    attempt++;
    await new Promise(r => setTimeout(r, 10_000));
    try {
      const resp = await fetch(`${IRIS_API}/${messageHash}`);
      if (resp.ok) {
        const data = await resp.json() as { status: string; attestation?: string };
        if (data.status === "complete" && data.attestation) return data.attestation;
        console.log(`${tag} attestation pending (attempt ${attempt})…`);
      }
    } catch { /* transient — retry */ }
  }
  console.warn(`${tag} attestation timed out after ${ATTESTATION_TIMEOUT_MS / 1000}s`);
  return null;
}

async function extractMessage(receipt: ethers.TransactionReceipt): Promise<{ messageBytes: string; messageHash: string } | null> {
  const log = (receipt.logs as ethers.Log[]).find(
    l => l.topics[0] === ethers.id("MessageSent(bytes)")
  );
  if (!log) return null;
  const messageBytes = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], log.data)[0] as string;
  return { messageBytes, messageHash: ethers.keccak256(messageBytes) };
}

/**
 * Bridge USDC from Arc → HL testnet. Returns burn tx hash + bridge status.
 * `status` is "complete" if mint landed, otherwise "stuck_attestation" or "stuck_mint".
 */
export async function bridgeArcToHl(amountUsd6: bigint): Promise<{ burnTxHash: string; status: "complete" | "stuck_attestation" | "stuck_mint" }> {
  const srcProvider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const srcWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_PYTHIA!, srcProvider);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, srcWallet);
  await (await usdc.approve(ARC_TOKEN_MESSENGER, amountUsd6)).wait();

  const tm = new ethers.Contract(ARC_TOKEN_MESSENGER, TM_ABI, srcWallet);
  const burnTx = await tm.depositForBurn(
    amountUsd6, HYPERLIQUID_CCTP_DOMAIN, addressToBytes32(srcWallet.address), USDC_ADDRESS,
  );
  const burnReceipt = await burnTx.wait();
  const burnTxHash = burnReceipt!.hash;
  console.log(`[pythia][cctp] burn on Arc: ${burnTxHash}`);

  const msg = await extractMessage(burnReceipt!);
  if (!msg) return { burnTxHash, status: "stuck_attestation" };

  const attestation = await pollIris(msg.messageHash, "[pythia][cctp][arc→hl]");
  if (!attestation) return { burnTxHash, status: "stuck_attestation" };

  try {
    const dstProvider = new ethers.JsonRpcProvider(process.env.DEST_RPC_URL!);
    const dstWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_PYTHIA!, dstProvider);
    const mt = new ethers.Contract(HL_MESSAGE_TRANSMITTER, MT_ABI, dstWallet);
    const mintTx = await mt.receiveMessage(msg.messageBytes, attestation);
    const mintReceipt = await mintTx.wait();
    console.log(`[pythia][cctp] mint on HL: ${mintReceipt!.hash}`);
    return { burnTxHash, status: "complete" };
  } catch (err) {
    console.warn(`[pythia][cctp] mint on HL failed:`, err);
    return { burnTxHash, status: "stuck_mint" };
  }
}

/**
 * Bridge USDC from HL testnet → Arc. Returns burn tx hash + bridge status.
 * Requires CCTP_TOKEN_MESSENGER_HL and MESSAGE_TRANSMITTER_ARC env vars.
 */
export async function bridgeHlToArc(amountUsd6: bigint): Promise<{ burnTxHash: string; status: "complete" | "stuck_attestation" | "stuck_mint" }> {
  if (!HL_TOKEN_MESSENGER || !ARC_MESSAGE_TRANSMITTER) {
    throw new Error("HL→Arc bridge requires CCTP_TOKEN_MESSENGER_HL and MESSAGE_TRANSMITTER_ARC env vars");
  }
  const srcProvider = new ethers.JsonRpcProvider(process.env.DEST_RPC_URL!);
  const srcWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_PYTHIA!, srcProvider);
  const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, srcWallet);
  await (await usdc.approve(HL_TOKEN_MESSENGER, amountUsd6)).wait();

  const tm = new ethers.Contract(HL_TOKEN_MESSENGER, TM_ABI, srcWallet);
  const burnTx = await tm.depositForBurn(
    amountUsd6, ARC_CCTP_DOMAIN, addressToBytes32(srcWallet.address), USDC_ADDRESS,
  );
  const burnReceipt = await burnTx.wait();
  const burnTxHash = burnReceipt!.hash;
  console.log(`[pythia][cctp] burn on HL: ${burnTxHash}`);

  const msg = await extractMessage(burnReceipt!);
  if (!msg) return { burnTxHash, status: "stuck_attestation" };

  const attestation = await pollIris(msg.messageHash, "[pythia][cctp][hl→arc]");
  if (!attestation) return { burnTxHash, status: "stuck_attestation" };

  try {
    const dstProvider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
    const dstWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_PYTHIA!, dstProvider);
    const mt = new ethers.Contract(ARC_MESSAGE_TRANSMITTER, MT_ABI, dstWallet);
    const mintTx = await mt.receiveMessage(msg.messageBytes, attestation);
    const mintReceipt = await mintTx.wait();
    console.log(`[pythia][cctp] mint on Arc: ${mintReceipt!.hash}`);
    return { burnTxHash, status: "complete" };
  } catch (err) {
    console.warn(`[pythia][cctp] mint on Arc failed:`, err);
    return { burnTxHash, status: "stuck_mint" };
  }
}
