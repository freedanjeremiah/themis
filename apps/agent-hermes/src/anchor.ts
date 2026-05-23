import { createHash } from "crypto";
import axios from "axios";
import { ethers } from "ethers";
import { TraceAnchorABI } from "@themis/shared/abis";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const AGENT_ID = "hermes";
const PRIVATE_KEY_ENV = "PRIVATE_KEY_HERMES";

const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
const wallet = new ethers.Wallet(process.env[PRIVATE_KEY_ENV]!, provider);
const anchorContract = new ethers.Contract(
  process.env.ANCHOR_ADDRESS!,
  TraceAnchorABI as any,
  wallet
);
const INDEXER_URL = process.env.INDEXER_URL ?? "http://localhost:3002";

export async function anchorTrace(
  traceJson: object,
  tradeIdea: string,
  confidence: number
): Promise<{ cid: string; hash: string }> {
  const traceStr = JSON.stringify(traceJson);
  const hashBytes = createHash("sha256").update(traceStr).digest();
  const hash = "0x" + hashBytes.toString("hex");

  let cid: string;
  try {
    const resp = await axios.post(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      { pinataContent: traceJson },
      { headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` } }
    );
    cid = `ipfs://${resp.data.IpfsHash}`;
  } catch {
    cid = `hash://${hash}`;
    console.warn(`[${AGENT_ID}] IPFS pin failed, using hash reference`);
  }

  // Anchor on-chain (non-fatal if it fails during dev/testnet)
  try {
    const tx = await anchorContract.anchor(wallet.address, hash, cid);
    await tx.wait();
  } catch (err) {
    console.error(`[${AGENT_ID}] on-chain anchor failed:`, err);
  }

  // Notify indexer with trace metadata
  try {
    await axios.post(`${INDEXER_URL}/traces`, {
      agentId: AGENT_ID,
      cid,
      hash,
      tradeIdea,
      confidence,
    });
  } catch { /* non-fatal */ }

  return { cid, hash };
}
