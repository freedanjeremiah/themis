/**
 * One-shot CCTP V2 testnet verifier (reverse): burn $1 USDC on HL testnet, poll Iris
 * sandbox for the attestation, mint on Arc testnet. Run AFTER verify-cctp-testnet.ts
 * so the HL wallet already holds $1 from the forward bridge.
 *
 * Usage:
 *   pnpm tsx scripts/verify-cctp-reverse.ts
 *
 * Required env:
 *   DEST_RPC_URL                    HL testnet RPC
 *   USDC_ADDRESS_HL                 HL-side USDC
 *   CCTP_TOKEN_MESSENGER_HL         HL-side TokenMessenger
 *   ARC_CCTP_DOMAIN                 CCTP destination domain for Arc (26)
 *   ARC_RPC_URL                     Arc testnet RPC
 *   MESSAGE_TRANSMITTER_ARC         Arc-side MessageTransmitter
 *   PRIVATE_KEY_HERMES              wallet with >= $1 testnet USDC on HL
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
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold) returns (uint64 nonce)",
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
      console.log(`[verify-cctp-reverse] attempt ${i + 1}: status=${data.status}`);
      if (data.status === "complete" && data.attestation) return data.attestation;
    } else {
      console.log(`[verify-cctp-reverse] attempt ${i + 1}: http ${resp.status}`);
    }
  }
  throw new Error("Iris attestation timed out after 10 min");
}

async function main() {
  const required = [
    "DEST_RPC_URL", "USDC_ADDRESS_HL", "CCTP_TOKEN_MESSENGER_HL",
    "ARC_CCTP_DOMAIN", "ARC_RPC_URL", "MESSAGE_TRANSMITTER_ARC", "PRIVATE_KEY_HERMES",
  ];
  for (const k of required) if (!process.env[k]) throw new Error(`Missing env: ${k}`);

  const amount = 1_000_000n; // $1.00 USDC (6 decimals)

  const srcProvider = new ethers.JsonRpcProvider(process.env.DEST_RPC_URL!);
  const srcWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, srcProvider);
  console.log(`[verify-cctp-reverse] source wallet (HL): ${srcWallet.address}`);

  const usdc = new ethers.Contract(process.env.USDC_ADDRESS_HL!, ERC20_ABI, srcWallet);
  const balBefore = await usdc.balanceOf(srcWallet.address);
  console.log(`[verify-cctp-reverse] USDC balance on HL testnet: ${Number(balBefore) / 1e6}`);
  if (balBefore < amount) {
    throw new Error("HL wallet needs >= $1 USDC. Run verify-cctp-testnet.ts first to bridge $1 to HL.");
  }

  console.log(`[verify-cctp-reverse] approving HL TokenMessenger...`);
  const ax = await usdc.approve(process.env.CCTP_TOKEN_MESSENGER_HL!, amount);
  await ax.wait();

  const arcDomain = Number(process.env.ARC_CCTP_DOMAIN!);
  console.log(`[verify-cctp-reverse] burning $1 on HL testnet → destDomain ${arcDomain}...`);
  const tm = new ethers.Contract(process.env.CCTP_TOKEN_MESSENGER_HL!, TM_ABI, srcWallet);
  const burnStart = Date.now();
  const burnTx = await tm.depositForBurn(
    amount,
    arcDomain,
    addressToBytes32(srcWallet.address),
    process.env.USDC_ADDRESS_HL!,
    ethers.ZeroHash,  // destinationCaller: anyone can mint
    0n,               // maxFee: slow path
    0,                // minFinalityThreshold: no finality requirement
  );
  const burnReceipt = await burnTx.wait();
  console.log(`[verify-cctp-reverse] burn tx: ${burnReceipt!.hash}`);

  const msLog = (burnReceipt!.logs as ethers.Log[]).find(
    l => l.topics[0] === ethers.id("MessageSent(bytes)")
  );
  if (!msLog) throw new Error("MessageSent log not found in burn receipt");
  const messageBytes = ethers.AbiCoder.defaultAbiCoder().decode(["bytes"], msLog.data)[0] as string;
  const messageHash = ethers.keccak256(messageBytes);
  console.log(`[verify-cctp-reverse] message hash: ${messageHash}`);

  console.log(`[verify-cctp-reverse] polling Iris sandbox...`);
  const attestation = await pollIris(messageHash);
  const irisMs = Date.now() - burnStart;
  console.log(`[verify-cctp-reverse] attestation received in ~${Math.round(irisMs / 1000)}s (${attestation.slice(0, 12)}...)`);

  const dstProvider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const dstWallet   = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!, dstProvider);
  const mt = new ethers.Contract(process.env.MESSAGE_TRANSMITTER_ARC!, MT_ABI, dstWallet);

  console.log(`[verify-cctp-reverse] receiveMessage on Arc testnet...`);
  const mintTx = await mt.receiveMessage(messageBytes, attestation);
  const mintReceipt = await mintTx.wait();
  const totalMs = Date.now() - burnStart;
  console.log(`[verify-cctp-reverse] mint tx: ${mintReceipt!.hash}`);
  console.log(`[verify-cctp-reverse] Iris latency:    ~${Math.round(irisMs / 1000)}s`);
  console.log(`[verify-cctp-reverse] Total roundtrip: ~${Math.round(totalMs / 1000)}s`);

  console.log(`\n[verify-cctp-reverse] === HL→ARC ROUNDTRIP COMPLETE — env values verified ===`);
}

main().catch(e => { console.error("[verify-cctp-reverse] FAILED:", e); process.exit(1); });
