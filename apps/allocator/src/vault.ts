import { ethers } from "ethers";
import { ThemisVaultABI, ThemisRegistryABI } from "@themis/shared/abis";
import { AgentId } from "@themis/shared";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

if (!process.env.VAULT_ADDRESS || !process.env.REGISTRY_ADDRESS) {
  throw new Error("[allocator] VAULT_ADDRESS and REGISTRY_ADDRESS must be set in .env");
}

const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY_ALLOCATOR!, provider);
const vault = new ethers.Contract(process.env.VAULT_ADDRESS!, ThemisVaultABI as any, wallet);
const registry = new ethers.Contract(process.env.REGISTRY_ADDRESS!, ThemisRegistryABI as any, wallet);

const AGENT_ADDRESSES: Record<AgentId, string> = {
  hermes: process.env.AGENT_ADDRESS_HERMES!,
  pythia: process.env.AGENT_ADDRESS_PYTHIA!,
  demeter: process.env.AGENT_ADDRESS_DEMETER!,
};

// All state-changing txs go through the same allocator wallet. Concurrent
// /settle requests (or a settle racing the cycle's allocate) would otherwise
// submit two txs with the same nonce and one would fail. Serialize them: each
// op waits for the previous to mine before submitting, so nonces never collide.
let txChain: Promise<unknown> = Promise.resolve();
function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = txChain.then(fn, fn);
  txChain = next.then(() => {}, () => {});
  return next;
}

export async function vaultAllocate(agentId: AgentId, amountUsdc6: bigint, cycleId: number): Promise<void> {
  return runExclusive(async () => {
    const tx = await vault.allocate(AGENT_ADDRESSES[agentId], amountUsdc6, BigInt(cycleId));
    await tx.wait();
  });
}

export async function vaultSettle(agentId: AgentId, pnlUsdc6: bigint): Promise<void> {
  return runExclusive(async () => {
    const tx = await vault.settle(AGENT_ADDRESSES[agentId], pnlUsdc6);
    await tx.wait();
  });
}

export async function registryRecord(agentId: AgentId, won: boolean, pnlUsdc6: bigint): Promise<void> {
  return runExclusive(async () => {
    const tx = await registry.recordOutcome(AGENT_ADDRESSES[agentId], won, pnlUsdc6);
    await tx.wait();
  });
}

export async function getTotalAssetsUsdc(): Promise<number> {
  const assets: bigint = await vault.totalAssets();
  const whole = Number(assets / BigInt(1_000_000));
  const frac = Number(assets % BigInt(1_000_000)) / 1_000_000;
  return whole + frac;
}
