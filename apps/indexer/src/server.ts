import express, { type Request, type Response, type NextFunction } from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  insertTrace,
  getRecentTraces,
  getLatestTotalAssets,
  getDepositCount,
  getAgentPnlHistory,
  getAgentSettlementCount,
} from "./db.js";
import { WsMessage } from "@themis/shared";
import { ethers } from "ethers";
import { ThemisVaultABI } from "@themis/shared/abis";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

// Live vault reads for the snapshot fields (current allocation), so the
// leaderboard/reserve reflect on-chain truth rather than cumulative event sums.
const _provider = process.env.ARC_RPC_URL ? new ethers.JsonRpcProvider(process.env.ARC_RPC_URL) : null;
const _vault = _provider && process.env.VAULT_ADDRESS
  ? new ethers.Contract(process.env.VAULT_ADDRESS, ThemisVaultABI as ethers.InterfaceAbi, _provider)
  : null;
const AGENT_ADDR: Record<string, string | undefined> = {
  hermes: process.env.AGENT_ADDRESS_HERMES,
  pythia: process.env.AGENT_ADDRESS_PYTHIA,
  demeter: process.env.AGENT_ADDRESS_DEMETER,
};

function computeSharpe(pnls: number[]): number {
  if (pnls.length < 2) return 0;
  const mean = pnls.reduce((s, v) => s + v, 0) / pnls.length;
  const variance = pnls.reduce((s, v) => s + (v - mean) ** 2, 0) / pnls.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return Math.max(-2, Math.min(2, mean / std));
}

function computeMaxDrawdown(pnls: number[]): number {
  let cumPnl = 0;
  let peak = 0;
  let maxDD = 0;
  for (const pnl of pnls) {
    cumPnl += pnl;
    if (cumPnl > peak) peak = cumPnl;
    if (peak > 0) {
      const dd = (peak - cumPnl) / peak;
      if (dd > maxDD) maxDD = dd;
    }
  }
  return maxDD;
}

export const app = express();
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});
app.use(express.json());
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

const clients = new Set<WebSocket>();
wss.on("connection", ws => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});

export function broadcast(msg: WsMessage): void {
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

app.get("/tvl", (_req, res) => {
  const row = getLatestTotalAssets.get() as { total_assets: number } | undefined;
  const { count } = getDepositCount.get() as { count: number };
  res.json({ totalUsdc: row?.total_assets ?? 0, depositCount: count });
});

app.get("/traces", (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  res.json(getRecentTraces.all(limit));
});

app.get("/agents", async (_req, res) => {
  const agents = await Promise.all(["hermes", "pythia", "demeter"].map(async id => {
    const pnlHistory = getAgentPnlHistory.all(id) as { pnl: number; timestamp: number }[];
    const { count } = getAgentSettlementCount.get(id) as { count: number };
    const pnls = pnlHistory.map(r => r.pnl);
    const sharpe = computeSharpe(pnls);
    const maxDrawdown = computeMaxDrawdown(pnls);
    // CURRENT allocation, read live from the vault (0 between cycles, set while
    // an agent holds a position). NOT the cumulative sum of all allocations.
    let currentAllocationUsdc = 0;
    const addr = AGENT_ADDR[id];
    if (_vault && addr) {
      try { currentAllocationUsdc = Number(await _vault.agentAllocation(addr)); } catch { /* read failed → 0 */ }
    }
    return { agentId: id, currentAllocationUsdc, tradesCompleted: count, sharpe, maxDrawdown, pnlHistory };
  }));
  res.json(agents);
});

app.get("/state", (_req, res) => {
  res.json({
    tvl: (getLatestTotalAssets.get() as { total_assets: number } | undefined)?.total_assets ?? 0,
    agents: ["hermes", "pythia", "demeter"].map(id => ({
      agentId: id,
      pnlHistory: getAgentPnlHistory.all(id),
    })),
  });
});

// Agents POST trace metadata here after anchoring
app.post("/traces", (req, res) => {
  const { agentId, cid, hash, tradeIdea, confidence } = req.body as {
    agentId?: string;
    cid?: string;
    hash?: string;
    tradeIdea?: string;
    confidence?: number;
  };
  if (!agentId || !cid || !hash) {
    return res.status(400).json({ error: "missing required fields" });
  }
  const blockTime = Math.floor(Date.now() / 1000);
  insertTrace.run(agentId, cid, hash, tradeIdea ?? "", confidence ?? 0, blockTime);
  broadcast({ event: "trace", data: { agentId, cid, hash, tradeIdea, confidence, blockTime } });
  res.json({ ok: true });
});

export { httpServer };
