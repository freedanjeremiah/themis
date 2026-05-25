import { ethers } from "ethers";
import { DatabaseSync } from "node:sqlite";
import { ThemisVaultABI } from "../packages/shared/src/abis/index.js";
import * as dotenv from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "../apps/themis.db");

const ADDRESS_TO_ID: Record<string, string> = {
  [process.env.AGENT_ADDRESS_HERMES?.toLowerCase() ?? ""]: "hermes",
  [process.env.AGENT_ADDRESS_PYTHIA?.toLowerCase() ?? ""]: "pythia",
  [process.env.AGENT_ADDRESS_DEMETER?.toLowerCase() ?? ""]: "demeter",
};

const db = new DatabaseSync(DB_PATH);

const hasTxHash = db.prepare(`
  SELECT 1 FROM (
    SELECT tx_hash FROM deposits UNION ALL
    SELECT tx_hash FROM allocations UNION ALL
    SELECT tx_hash FROM settlements
  ) WHERE tx_hash=?
`);
const insertDeposit = db.prepare(`INSERT INTO deposits (wallet, amount_usdc, shares, tx_hash, block_time) VALUES (?,?,?,?,?)`);
const insertAllocation = db.prepare(`INSERT INTO allocations (agent_id, amount_usdc, cycle_id, tx_hash, block_time) VALUES (?,?,?,?,?)`);
const insertSettlement = db.prepare(`INSERT INTO settlements (agent_id, pnl_usdc, total_assets, tx_hash, block_time) VALUES (?,?,?,?,?)`);

const CHUNK = 9000;

async function queryAll(vault: ethers.Contract, filter: ethers.ContractEventName, from: number, to: number): Promise<ethers.EventLog[]> {
  const results: ethers.EventLog[] = [];
  for (let start = from; start <= to; start += CHUNK) {
    const end = Math.min(start + CHUNK - 1, to);
    const chunk = await vault.queryFilter(filter, start, end) as ethers.EventLog[];
    if (chunk.length) results.push(...chunk);
  }
  return results;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
  const vault = new ethers.Contract(process.env.VAULT_ADDRESS!, ThemisVaultABI as ethers.InterfaceAbi, provider);

  const currentBlock = await provider.getBlockNumber();
  // start ~250k blocks back (~1 day on Arc) to cover all cycles since deployment
  const fromBlock = Math.max(0, currentBlock - 250_000);
  console.log(`current block: ${currentBlock}, scanning from: ${fromBlock}`);

  console.log("fetching Deposited events...");
  const deposited = await queryAll(vault, vault.filters.Deposited(), fromBlock, currentBlock);
  console.log(`  found ${deposited.length}`);

  console.log("fetching Allocated events...");
  const allocated = await queryAll(vault, vault.filters.Allocated(), fromBlock, currentBlock);
  console.log(`  found ${allocated.length}`);

  console.log("fetching Settled events...");
  const settled = await queryAll(vault, vault.filters.Settled(), fromBlock, currentBlock);
  console.log(`  found ${settled.length}`);

  let ins = 0;
  for (const e of deposited) {
    if (hasTxHash.get(e.transactionHash)) continue;
    const [wallet, amount, shares] = e.args;
    insertDeposit.run(wallet, Number(amount), Number(shares), e.transactionHash, Math.floor(Date.now() / 1000));
    ins++;
  }
  console.log(`inserted ${ins} deposits`);

  ins = 0;
  for (const e of allocated) {
    if (hasTxHash.get(e.transactionHash)) continue;
    const [agent, amount, cycleId] = e.args;
    const agentId = ADDRESS_TO_ID[agent.toLowerCase()];
    if (!agentId) { console.warn(`unknown agent: ${agent}`); continue; }
    insertAllocation.run(agentId, Number(amount), Number(cycleId), e.transactionHash, Math.floor(Date.now() / 1000));
    ins++;
  }
  console.log(`inserted ${ins} allocations`);

  ins = 0;
  for (const e of settled) {
    if (hasTxHash.get(e.transactionHash)) continue;
    const [agent, pnl, totalAssets] = e.args;
    const agentId = ADDRESS_TO_ID[agent.toLowerCase()];
    if (!agentId) { console.warn(`unknown agent: ${agent}`); continue; }
    insertSettlement.run(agentId, Number(pnl), Number(totalAssets), e.transactionHash, Math.floor(Date.now() / 1000));
    ins++;
  }
  console.log(`inserted ${ins} settlements`);

  const a = db.prepare("SELECT COUNT(*) as c FROM allocations").get() as { c: number };
  const s = db.prepare("SELECT COUNT(*) as c FROM settlements").get() as { c: number };
  const d = db.prepare("SELECT COUNT(*) as c FROM deposits").get() as { c: number };
  console.log(`\nDB totals — allocations: ${a.c}, settlements: ${s.c}, deposits: ${d.c}`);
}

main().catch(e => { console.error(e); process.exit(1); });
