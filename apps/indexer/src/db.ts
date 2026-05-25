// Uses Node.js built-in SQLite (available since Node 22.5, stable in Node 24)
// No native compilation required — avoids the need for Visual Studio Build Tools on Windows
import { DatabaseSync } from "node:sqlite";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.INDEXER_DB_PATH ?? join(__dirname, "../../themis.db");
const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet TEXT NOT NULL,
    amount_usdc INTEGER NOT NULL,
    shares INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    block_time INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    amount_usdc INTEGER NOT NULL,
    cycle_id INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    block_time INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    pnl_usdc INTEGER NOT NULL,
    total_assets INTEGER NOT NULL,
    tx_hash TEXT NOT NULL,
    block_time INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    cid TEXT NOT NULL,
    hash TEXT NOT NULL,
    trade_idea TEXT NOT NULL,
    confidence REAL NOT NULL,
    block_time INTEGER NOT NULL
  );
`);

export const insertDeposit = db.prepare(
  `INSERT INTO deposits (wallet, amount_usdc, shares, tx_hash, block_time) VALUES (?,?,?,?,?)`
);
export const insertAllocation = db.prepare(
  `INSERT INTO allocations (agent_id, amount_usdc, cycle_id, tx_hash, block_time) VALUES (?,?,?,?,?)`
);
export const insertSettlement = db.prepare(
  `INSERT INTO settlements (agent_id, pnl_usdc, total_assets, tx_hash, block_time) VALUES (?,?,?,?,?)`
);
export const insertTrace = db.prepare(
  `INSERT INTO traces (agent_id, cid, hash, trade_idea, confidence, block_time) VALUES (?,?,?,?,?,?)`
);
export const getRecentTraces = db.prepare(
  `SELECT * FROM traces ORDER BY block_time DESC LIMIT ?`
);
// Order by id (insertion order = chronological, since backfill inserts in block
// order) NOT block_time — backfill stamps every row with the same insertion
// timestamp, so block_time can't distinguish the latest settlement.
export const getLatestTotalAssets = db.prepare(
  `SELECT total_assets FROM settlements ORDER BY id DESC LIMIT 1`
);
export const getDepositCount = db.prepare(
  `SELECT COUNT(DISTINCT wallet) as count FROM deposits`
);
export const getAgentAllocations = db.prepare(
  `SELECT agent_id, SUM(amount_usdc) as total FROM allocations GROUP BY agent_id`
);
export const getAgentPnlHistory = db.prepare(
  `SELECT pnl_usdc as pnl, block_time as timestamp FROM settlements WHERE agent_id=? ORDER BY block_time DESC LIMIT 50`
);
export const getAgentSettlementCount = db.prepare(
  `SELECT COUNT(*) as count FROM settlements WHERE agent_id=?`
);
export const hasTxHash = db.prepare(
  `SELECT 1 FROM (
    SELECT tx_hash FROM deposits UNION ALL
    SELECT tx_hash FROM allocations UNION ALL
    SELECT tx_hash FROM settlements
  ) WHERE tx_hash=?`
);

export default db;
