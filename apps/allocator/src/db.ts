// File-backed SQLite for allocator state. Uses Node's built-in driver.
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../../.env") });

const DB_PATH = process.env.ALLOCATOR_DB_PATH ?? join(__dirname, "../state.db");

export const db = new DatabaseSync(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS agent_state (
    agent_id TEXT PRIMARY KEY,
    trades_completed INTEGER NOT NULL DEFAULT 0,
    cumulative_pnl_today INTEGER NOT NULL DEFAULT 0,
    last_settle_day INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS pnl_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    agent_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    pnl_usdc6 INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pnl_agent ON pnl_history(agent_id, ts);
`);

export const upsertAgentState = db.prepare(`
  INSERT INTO agent_state (agent_id, trades_completed, cumulative_pnl_today, last_settle_day)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(agent_id) DO UPDATE SET
    trades_completed = excluded.trades_completed,
    cumulative_pnl_today = excluded.cumulative_pnl_today,
    last_settle_day = excluded.last_settle_day
`);

export const insertPnl = db.prepare(`
  INSERT INTO pnl_history (agent_id, ts, pnl_usdc6) VALUES (?, ?, ?)
`);

export const selectAgentState = db.prepare(`
  SELECT trades_completed, cumulative_pnl_today, last_settle_day FROM agent_state WHERE agent_id = ?
`);

export const selectPnlHistory = db.prepare(`
  SELECT ts, pnl_usdc6 FROM pnl_history WHERE agent_id = ? ORDER BY ts DESC LIMIT 100
`);
