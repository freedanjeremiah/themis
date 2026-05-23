import { ethers } from "ethers";
import { ThemisVaultABI } from "@themis/shared/abis";
import { insertDeposit, insertAllocation, insertSettlement } from "./db.js";
import { broadcast } from "./server.js";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const ADDRESS_TO_ID: Record<string, string> = {
  [process.env.AGENT_ADDRESS_HERMES?.toLowerCase() ?? ""]: "hermes",
  [process.env.AGENT_ADDRESS_PYTHIA?.toLowerCase() ?? ""]: "pythia",
  [process.env.AGENT_ADDRESS_DEMETER?.toLowerCase() ?? ""]: "demeter",
};

export function startPolling(): void {
  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const vault = new ethers.Contract(
    process.env.VAULT_ADDRESS!,
    ThemisVaultABI as ethers.InterfaceAbi,
    provider
  );

  vault.on("Deposited", (wallet: string, amount: bigint, shares: bigint, event: ethers.EventLog) => {
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
