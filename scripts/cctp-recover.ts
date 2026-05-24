/**
 * Manual CCTP recovery for a stuck burn.
 *
 * Usage:
 *   pnpm tsx scripts/cctp-recover.ts <agentId> <burnTxHash> [direction]
 *
 *   agentId    hermes | pythia | demeter (selects which PRIVATE_KEY to use)
 *   burnTxHash the tx hash from the failed bridge
 *   direction  arc-to-hl (default) | hl-to-arc
 *
 * The script fetches the burn receipt, extracts the MessageSent log, polls
 * Iris for the attestation, and calls receiveMessage on the destination chain.
 *
 * After success, the operator should also POST {agentId, reason: null} to
 * the allocator's /stuck endpoint to clear the stuck flag.
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const IRIS_API = "https://iris-api-sandbox.circle.com/attestations";

const MT_ABI = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
] as const;

async function pollIris(messageHash: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const resp = await fetch(`${IRIS_API}/${messageHash}`);
    if (resp.ok) {
      const data = await resp.json() as { status: string; attestation?: string };
      console.log(`[recover] attempt ${i + 1}: status=${data.status}`);
      if (data.status === "complete" && data.attestation) return data.attestation;
    } else {
      console.log(`[recover] attempt ${i + 1}: http ${resp.status}`);
    }
  }
  throw new Error("Iris attestation never landed after 10 min");
}

async function main() {
  const [agentId, burnTxHash, dir = "arc-to-hl"] = process.argv.slice(2);
  if (!agentId || !burnTxHash) {
    console.error("Usage: pnpm tsx scripts/cctp-recover.ts <agentId> <burnTxHash> [arc-to-hl|hl-to-arc]");
    process.exit(1);
  }
  const keyEnv = `PRIVATE_KEY_${agentId.toUpperCase()}`;
  const pk = process.env[keyEnv];
  if (!pk) throw new Error(`Missing env ${keyEnv}`);

  const isArcToHl = dir === "arc-to-hl";
  const srcRpc = isArcToHl ? process.env.ARC_RPC_URL! : process.env.DEST_RPC_URL!;
  const dstRpc = isArcToHl ? process.env.DEST_RPC_URL! : process.env.ARC_RPC_URL!;
  const dstTransmitter = isArcToHl
    ? process.env.MESSAGE_TRANSMITTER_DEST!
    : (process.env.MESSAGE_TRANSMITTER_ARC ?? "");
  if (!dstTransmitter) throw new Error("Missing destination MessageTransmitter env");

  const srcProvider = new ethers.JsonRpcProvider(srcRpc);
  const receipt = await srcProvider.getTransactionReceipt(burnTxHash);
  if (!receipt) throw new Error(`Receipt not found for ${burnTxHash} on src chain`);

  const log = (receipt.logs as ethers.Log[]).find(
    l => l.topics[0] === ethers.id("MessageSent(bytes)")
  );
  if (!log) throw new Error("MessageSent log not found in receipt");
  const messageBytes = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], log.data)[0] as string;
  const messageHash = ethers.keccak256(messageBytes);
  console.log(`[recover] burn tx ${burnTxHash}; message hash ${messageHash}`);

  console.log(`[recover] polling Iris...`);
  const attestation = await pollIris(messageHash);
  console.log(`[recover] attestation acquired (${attestation.slice(0, 12)}...)`);

  const dstProvider = new ethers.JsonRpcProvider(dstRpc);
  const dstWallet   = new ethers.Wallet(pk, dstProvider);
  const mt          = new ethers.Contract(dstTransmitter, MT_ABI, dstWallet);
  console.log(`[recover] calling receiveMessage on ${dstTransmitter}...`);
  const mintTx = await mt.receiveMessage(messageBytes, attestation);
  const mintReceipt = await mintTx.wait();
  console.log(`[recover] mint OK: ${mintReceipt!.hash}`);

  console.log(`\nNext: clear the stuck flag with:`);
  console.log(`  curl -X POST ${process.env.ALLOCATOR_URL ?? "http://localhost:3001"}/stuck \\`);
  console.log(`    -H 'Content-Type: application/json' \\`);
  console.log(`    -d '{"agentId":"${agentId}","reason":null}'`);
}

main().catch(err => { console.error("[recover] FAILED:", err); process.exit(1); });
