"use client";
import { createContext, useContext, useCallback, useEffect, useState } from "react";
import { useIndexerSocket, type WsConnectionState } from "../hooks/useIndexerSocket";
import { type TraceItem } from "./TraceCard";
import { AGENT_META, type AgentId } from "../lib/agent-meta";
import type { WsMessage } from "@themis/shared";

export type AgentRow = {
  agentId: string;
  allocationUsdc: number;
  pnlHistory: { timestamp: number; pnl: number }[];
  sidelined: boolean;
  tradesCompleted: number;
  sharpe: number;
  maxDrawdown: number;
  cumPnlRaw: number;
  returnPct: number;
};

const SEED_RAW = 10_000_000; // $10 seed per agent, raw USDC (6 decimals)

const INITIAL: AgentRow[] = (["hermes", "pythia", "demeter"] as AgentId[]).map(id => ({
  agentId: id, allocationUsdc: 0, pnlHistory: [], sidelined: false,
  tradesCompleted: 0, sharpe: 0, maxDrawdown: 0, cumPnlRaw: 0, returnPct: 0,
}));

type ThemisData = {
  tvl: number;
  depositCount: number;
  agents: AgentRow[];
  traces: TraceItem[];
  feed: WsMessage[];
  wsState: WsConnectionState;
  liquidReservePct: number;
  activeAgents: number;
  leader: { name: string; pct: number };
};

const Ctx = createContext<ThemisData | null>(null);

export function useThemisData(): ThemisData {
  const v = useContext(Ctx);
  if (!v) throw new Error("useThemisData must be used inside <DataProvider>");
  return v;
}

function withDerived(rows: Omit<AgentRow, "cumPnlRaw" | "returnPct">[]): AgentRow[] {
  return rows.map(a => {
    const cumPnlRaw = a.pnlHistory.reduce((s, p) => s + p.pnl, 0);
    return { ...a, cumPnlRaw, returnPct: (cumPnlRaw / SEED_RAW) * 100 };
  });
}

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [tvl, setTvl] = useState(0);
  const [depositCount, setDepositCount] = useState(0);
  const [agents, setAgents] = useState<AgentRow[]>(INITIAL);
  const [traces, setTraces] = useState<TraceItem[]>([]);
  const [feed, setFeed] = useState<WsMessage[]>([]);

  const onMessage = useCallback((msg: WsMessage) => {
    setFeed(prev => [msg, ...prev].slice(0, 32));
    if (msg.event === "deposit") {
      const d = msg.data as { amount: number };
      setTvl(prev => prev + d.amount);
      setDepositCount(prev => prev + 1);
    }
    if (msg.event === "allocation") {
      const d = msg.data as { agentId: string; amount: number };
      setAgents(prev => withDerived(prev.map(a => a.agentId === d.agentId ? { ...a, allocationUsdc: d.amount } : a)));
    }
    if (msg.event === "settlement") {
      const d = msg.data as { agentId: string; pnl: number; totalAssets: number };
      setTvl(d.totalAssets);
      setAgents(prev => withDerived(prev.map(a =>
        a.agentId === d.agentId
          ? { ...a, allocationUsdc: 0, pnlHistory: [...a.pnlHistory, { timestamp: Date.now(), pnl: d.pnl }] }
          : a
      )));
    }
    if (msg.event === "trace") {
      setTraces(prev => [msg.data as TraceItem, ...prev].slice(0, 20));
    }
  }, []);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:3002";

    // Vault snapshot (TVL, depositors, per-agent allocation/standings). These are
    // cheap indexer REST reads (no IPFS), so we poll them so the numbers stay live
    // between the sparse WebSocket settlement events. /tvl reads the chain directly.
    const pollVault = () => {
      fetch(`${url}/tvl`).then(r => r.ok ? r.json() : null).then((d: any) => {
        if (typeof d?.totalUsdc === "number") setTvl(d.totalUsdc);
        if (typeof d?.depositCount === "number") setDepositCount(d.depositCount);
      }).catch(() => {});

      fetch(`${url}/agents`).then(r => r.ok ? r.json() : null).then((data: unknown) => {
        if (!Array.isArray(data)) return;
        setAgents(prev => withDerived(prev.map(agent => {
          const live = (data as Array<any>).find(a => a.agentId === agent.agentId);
          if (!live) return agent;
          return {
            ...agent,
            allocationUsdc: live.currentAllocationUsdc ?? agent.allocationUsdc,
            sidelined: live.sidelined ?? agent.sidelined,
            pnlHistory: live.pnlHistory ?? agent.pnlHistory,
            tradesCompleted: live.tradesCompleted ?? agent.tradesCompleted,
            sharpe: live.sharpe ?? agent.sharpe,
            maxDrawdown: live.maxDrawdown ?? agent.maxDrawdown,
          };
        })));
      }).catch(() => {});
    };

    // Trace feed only needs an initial backfill; new dispatches arrive over WS.
    fetch(`${url}/traces?limit=20`).then(r => r.ok ? r.json() : null).then((data: unknown) => {
      if (!Array.isArray(data)) return;
      setTraces((data as Array<Record<string, unknown>>).map(r => ({
        id: r.id as number,
        agentId: (r.agentId ?? r.agent_id) as string,
        cid: r.cid as string,
        hash: r.hash as string,
        tradeIdea: (r.tradeIdea ?? r.trade_idea) as string,
        confidence: r.confidence as number,
        blockTime: (r.blockTime ?? r.block_time) as number,
      })));
    }).catch(() => {});

    pollVault();
    const iv = setInterval(pollVault, 15_000);
    return () => clearInterval(iv);
  }, []);

  const wsState = useIndexerSocket(onMessage);

  const totalAllocated = agents.reduce((s, a) => s + a.allocationUsdc, 0);
  const liquidReservePct = tvl > 0 ? ((tvl - totalAllocated) / tvl) * 100 : 100;
  const activeAgents = agents.filter(a => a.allocationUsdc > 0).length;
  const top = [...agents].sort((a, b) => b.cumPnlRaw - a.cumPnlRaw)[0];
  const leaderName = top && (["hermes", "pythia", "demeter"] as AgentId[]).includes(top.agentId as AgentId)
    ? AGENT_META[top.agentId as AgentId].name : "—";
  const leader = { name: leaderName, pct: top?.returnPct ?? 0 };

  return (
    <Ctx.Provider value={{ tvl, depositCount, agents, traces, feed, wsState, liquidReservePct, activeAgents, leader }}>
      {children}
    </Ctx.Provider>
  );
}
