import { ethers } from "ethers";
import { ThemisVaultABI } from "@themis/shared/abis";
import { insertDeposit, insertAllocation, insertSettlement, hasTxHash } from "./db.js";
import { broadcast } from "./server.js";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const ADDRESS_TO_ID: Record<string, string> = {
  [process.env.AGENT_ADDRESS_HERMES?.toLowerCase() ?? ""]: "hermes",
  [process.env.AGENT_ADDRESS_PYTHIA?.toLowerCase() ?? ""]: "pythia",
  [process.env.AGENT_ADDRESS_DEMETER?.toLowerCase() ?? ""]: "demeter",
};

// Arc testnet limits eth_getLogs to 10,000 block range — paginate in chunks
const BACKFILL_CHUNK = 9000;

async function queryChunked(vault: ethers.Contract, filter: ethers.ContractEventName, from: number, to: number): Promise<ethers.EventLog[]> {
  const results: ethers.EventLog[] = [];
  for (let start = from; start <= to; start += BACKFILL_CHUNK) {
    const end = Math.min(start + BACKFILL_CHUNK - 1, to);
    const chunk = await vault.queryFilter(filter, start, end) as ethers.EventLog[];
    if (chunk.length) results.push(...chunk);
  }
  return results;
}

async function backfill(vault: ethers.Contract, provider: ethers.JsonRpcProvider): Promise<void> {
  console.log("[indexer] backfilling historical vault events...");
  try {
    const currentBlock = await provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 250_000);

    const [deposited, allocated, settled] = await Promise.all([
      queryChunked(vault, vault.filters.Deposited(), fromBlock, currentBlock),
      queryChunked(vault, vault.filters.Allocated(), fromBlock, currentBlock),
      queryChunked(vault, vault.filters.Settled(), fromBlock, currentBlock),
    ]);

    for (const e of deposited) {
      if (hasTxHash.get(e.transactionHash)) continue;
      const [wallet, amount, shares] = e.args;
      insertDeposit.run(wallet, Number(amount), Number(shares), e.transactionHash, Math.floor(Date.now() / 1000));
    }

    for (const e of allocated) {
      if (hasTxHash.get(e.transactionHash)) continue;
      const [agent, amount, cycleId] = e.args;
      const agentId = ADDRESS_TO_ID[agent.toLowerCase()];
      if (!agentId) continue;
      insertAllocation.run(agentId, Number(amount), Number(cycleId), e.transactionHash, Math.floor(Date.now() / 1000));
    }

    for (const e of settled) {
      if (hasTxHash.get(e.transactionHash)) continue;
      const [agent, pnl, totalAssets] = e.args;
      const agentId = ADDRESS_TO_ID[agent.toLowerCase()];
      if (!agentId) continue;
      insertSettlement.run(agentId, Number(pnl), Number(totalAssets), e.transactionHash, Math.floor(Date.now() / 1000));
    }

    console.log(`[indexer] backfill done — ${deposited.length} deposits, ${allocated.length} allocations, ${settled.length} settlements`);
  } catch (err) {
    console.warn("[indexer] backfill failed (non-fatal):", err);
  }
}

export function startPolling(): void {
  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const vault = new ethers.Contract(
    process.env.VAULT_ADDRESS!,
    ThemisVaultABI as ethers.InterfaceAbi,
    provider
  );

  backfill(vault, provider);

  vault.on("Deposited", (wallet: string, amount: bigint, shares: bigint, event: ethers.EventLog) => {
    if (hasTxHash.get(event.transactionHash)) return;
    insertDeposit.run(
      wallet,
      Number(amount),
      Number(shares),
      event.transactionHash,
      Math.floor(Date.now() / 1000)
    );
    broadcast({
      event: "deposit",
      data: { wallet, amount: Number(amount), shares: Number(shares) },
    });
    console.log(`[indexer] Deposited ${Number(amount) / 1e6} USDC from ${wallet}`);
  });

  vault.on("Allocated", (agent: string, amount: bigint, cycleId: bigint, event: ethers.EventLog) => {
    if (hasTxHash.get(event.transactionHash)) return;
    const agentId = ADDRESS_TO_ID[agent.toLowerCase()];
    if (!agentId) {
      console.warn(`[indexer] Unknown agent address: ${agent} — skipping event`);
      return;
    }
    insertAllocation.run(
      agentId,
      Number(amount),
      Number(cycleId),
      event.transactionHash,
      Math.floor(Date.now() / 1000)
    );
    broadcast({
      event: "allocation",
      data: { agentId, amount: Number(amount), cycleId: Number(cycleId) },
    });
  });

  vault.on("Settled", (agent: string, pnl: bigint, totalAssets: bigint, event: ethers.EventLog) => {
    if (hasTxHash.get(event.transactionHash)) return;
    const agentId = ADDRESS_TO_ID[agent.toLowerCase()];
    if (!agentId) {
      console.warn(`[indexer] Unknown agent address: ${agent} — skipping event`);
      return;
    }
    insertSettlement.run(
      agentId,
      Number(pnl),
      Number(totalAssets),
      event.transactionHash,
      Math.floor(Date.now() / 1000)
    );
    broadcast({
      event: "settlement",
      data: { agentId, pnl: Number(pnl), totalAssets: Number(totalAssets) },
    });
  });

  console.log("[indexer] polling Arc events...");
}
