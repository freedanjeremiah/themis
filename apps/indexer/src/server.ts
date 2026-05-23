import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import {
  insertTrace,
  getRecentTraces,
  getLatestTotalAssets,
  getDepositCount,
  getAgentAllocations,
  getAgentPnlHistory,
  getAgentSettlementCount,
} from "./db.js";
import { WsMessage } from "@themis/shared";

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

app.get("/agents", (_req, res) => {
  const allocations = getAgentAllocations.all() as { agent_id: string; total: number }[];
  const agents = ["hermes", "pythia", "demeter"].map(id => {
    const alloc = allocations.find(a => a.agent_id === id);
    const pnlHistory = getAgentPnlHistory.all(id) as { pnl: number; timestamp: number }[];
    const { count } = getAgentSettlementCount.get(id) as { count: number };
    const pnls = pnlHistory.map(r => r.pnl);
    const sharpe = computeSharpe(pnls);
    const maxDrawdown = computeMaxDrawdown(pnls);
    return {
      agentId: id,
      currentAllocationUsdc: alloc?.total ?? 0,
      tradesCompleted: count,
      sharpe,
      maxDrawdown,
      pnlHistory,
    };
  });
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
