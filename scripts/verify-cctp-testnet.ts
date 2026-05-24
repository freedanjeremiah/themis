/**
 * One-shot CCTP V2 testnet verifier: burn $1 USDC on Arc testnet, poll Iris
 * sandbox for the attestation, mint on HL testnet. Confirms env values are
 * correct before agent code relies on them.
 *
 * Usage:
 *   pnpm tsx scripts/verify-cctp-testnet.ts
 *
 * Required env:
 *   ARC_RPC_URL                     Arc testnet RPC
 *   USDC_ADDRESS                    Arc-side USDC (0x3600...)
 *   CCTP_TOKEN_MESSENGER            Arc-side TokenMessenger
 *   HYPERLIQUID_CCTP_DOMAIN         CCTP destination domain (likely 19 for HL testnet)
 *   DEST_RPC_URL                    HL testnet RPC
 *   MESSAGE_TRANSMITTER_DEST        HL-side MessageTransmitter
 *   PRIVATE_KEY_HERMES              (or any wallet with >= $2 testnet USDC on Arc)
 */
import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config();

const IRIS_SANDBOX = "https://iris-api-sandbox.circle.com/attestations";

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address) view returns (uint256)",
] as const;
const TM_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken) returns (uint64 nonce)",
] as const;
const MT_ABI = [
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
] as const;

function addressToBytes32(addr: string): string {
  return "0x" + addr.slice(2).toLowerCase().padStart(64, "0");
}

async function pollIris(messageHash: string, maxAttempts = 60): Promise<string> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 10_000));
    const resp = await fetch(`${IRIS_SANDBOX}/${messageHash}`);
    if (resp.ok) {
      const data = await resp.json() as { status: string; attestation?: string };
      console.log(`[verify-cctp] attempt ${i + 1}: status=${data.status}`);
      if (data.status === "complete" && data.attestation) return data.attestation;
    } else {
      console.log(`[verify-cctp] attempt ${i + 1}: http ${resp.status}`);
    }
  }
  throw new Error("Iris attestation timed out after 10 min");
}

async function main() {
  const required = ["ARC_RPC_URL", "USDC_ADDRESS", "CCTP_TOKEN_MESSENGER",
    "HYPERLIQUID_CCTP_DOMAIN", "DEST_RPC_URL", "MESSAGE_TRANSMITTER_DEST", "PRIVATE_KEY_HERMES"];
  for (const k of required) if (!process.env[k]) throw new Error(`Missing env: ${k}`);

  const amount = 1_000_000n; // $1.00 USDC (6 decimals)

  const srcProvider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const srcWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, srcProvider);
  console.log(`[verify-cctp] source wallet: ${srcWallet.address}`);

  const usdc = new ethers.Contract(process.env.USDC_ADDRESS!, ERC20_ABI, srcWallet);
  const balBefore = await usdc.balanceOf(srcWallet.address);
  console.log(`[verify-cctp] USDC balance on Arc: ${Number(balBefore) / 1e6}`);
  if (balBefore < amount) throw new Error("Source wallet needs >= $1 USDC on Arc testnet");

  // Step 1: approve TokenMessenger
  console.log(`[verify-cctp] approving TokenMessenger...`);
  const ax = await usdc.approve(process.env.CCTP_TOKEN_MESSENGER!, amount);
  await ax.wait();

  // Step 2: depositForBurn
  console.log(`[verify-cctp] burning $1 on Arc → destDomain ${process.env.HYPERLIQUID_CCTP_DOMAIN}...`);
  const tm = new ethers.Contract(process.env.CCTP_TOKEN_MESSENGER!, TM_ABI, srcWallet);
  const burnTx = await tm.depositForBurn(
    amount,
    Number(process.env.HYPERLIQUID_CCTP_DOMAIN!),
    addressToBytes32(srcWallet.address),
    process.env.USDC_ADDRESS!,
  );
  const burnReceipt = await burnTx.wait();
  console.log(`[verify-cctp] burn tx: ${burnReceipt!.hash}`);

  // Step 3: extract MessageSent log + hash the message
  const msLog = (burnReceipt!.logs as ethers.Log[]).find(
    l => l.topics[0] === ethers.id("MessageSent(bytes)")
  );
  if (!msLog) throw new Error("MessageSent log not found in burn receipt");
  const messageBytes = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], msLog.data)[0] as string;
  const messageHash = ethers.keccak256(messageBytes);
  console.log(`[verify-cctp] message hash: ${messageHash}`);

  // Step 4: poll Iris
  console.log(`[verify-cctp] polling Iris sandbox...`);
  const attestation = await pollIris(messageHash);
  console.log(`[verify-cctp] attestation received (${attestation.slice(0, 12)}...)`);

  // Step 5: mint on HL testnet
  const dstProvider = new ethers.JsonRpcProvider(process.env.DEST_RPC_URL!);
  const dstWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, dstProvider);
  const mt = new ethers.Contract(process.env.MESSAGE_TRANSMITTER_DEST!, MT_ABI, dstWallet);

  console.log(`[verify-cctp] receiveMessage on HL testnet...`);
  const mintTx = await mt.receiveMessage(messageBytes, attestation);
  const mintReceipt = await mintTx.wait();
  console.log(`[verify-cctp] mint tx: ${mintReceipt!.hash}`);

  console.log(`\n[verify-cctp] === ROUNDTRIP COMPLETE — env values verified ===`);
}

main().catch(e => { console.error("[verify-cctp] FAILED:", e); process.exit(1); });
