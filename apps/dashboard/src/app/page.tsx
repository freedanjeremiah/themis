"use client";
import { useState, useCallback, useEffect } from "react";
import { useIndexerSocket } from "../hooks/useIndexerSocket";
import { TvlBar } from "../components/TvlBar";
import { AgentLeaderboard } from "../components/AgentLeaderboard";
import { TracesFeed } from "../components/TracesFeed";
import { DepositPanel } from "../components/DepositPanel";
import { WsMessage } from "@themis/shared";

type AgentRow = {
  agentId: string;
  allocationUsdc: number;
  totalUsdc: number;
  pnlHistory: { timestamp: number; pnl: number }[];
  sidelined: boolean;
  tradesCompleted: number;
  sharpe: number;
  maxDrawdown: number;
};

type TraceItem = {
  id?: number;
  agentId: string;
  cid: string;
  hash: string;
  tradeIdea: string;
  confidence: number;
  blockTime: number;
};

const INITIAL_AGENTS: AgentRow[] = [
  { agentId: "hermes", allocationUsdc: 0, totalUsdc: 0, pnlHistory: [], sidelined: false, tradesCompleted: 0, sharpe: 0, maxDrawdown: 0 },
  { agentId: "pythia",  allocationUsdc: 0, totalUsdc: 0, pnlHistory: [], sidelined: false, tradesCompleted: 0, sharpe: 0, maxDrawdown: 0 },
  { agentId: "demeter", allocationUsdc: 0, totalUsdc: 0, pnlHistory: [], sidelined: false, tradesCompleted: 0, sharpe: 0, maxDrawdown: 0 },
];

export default function Home() {
  const [tvl, setTvl] = useState(0);
  const [depositCount, setDepositCount] = useState(0);
  const [agents, setAgents] = useState<AgentRow[]>(INITIAL_AGENTS);
  const [traces, setTraces] = useState<TraceItem[]>([]);

  const onMessage = useCallback((msg: WsMessage) => {
    if (msg.event === "deposit") {
      const d = msg.data as { amount: number };
      setTvl(prev => prev + d.amount);
      setDepositCount(prev => prev + 1);
    }
    if (msg.event === "allocation") {
      const d = msg.data as { agentId: string; amount: number };
      setAgents(prev =>
        prev.map(a => a.agentId === d.agentId ? { ...a, allocationUsdc: d.amount } : a)
      );
    }
    if (msg.event === "settlement") {
      const d = msg.data as { agentId: string; pnl: number; totalAssets: number };
      setTvl(d.totalAssets);
      setAgents(prev =>
        prev.map(a =>
          a.agentId === d.agentId
            ? {
                ...a,
                allocationUsdc: 0,
                pnlHistory: [...a.pnlHistory, { timestamp: Date.now(), pnl: d.pnl }],
              }
            : a
        )
      );
    }
    if (msg.event === "trace") {
      const d = msg.data as TraceItem;
      setTraces(prev => [d, ...prev].slice(0, 20));
    }
  }, []);

  useEffect(() => {
    const indexerUrl = process.env.NEXT_PUBLIC_INDEXER_URL ?? "http://localhost:3002";
    fetch(`${indexerUrl}/agents`)
      .then(r => r.ok ? r.json() : null)
      .then((data: unknown) => {
        if (!Array.isArray(data)) return;
        setAgents(prev => prev.map(agent => {
          const live = (data as Array<{agentId: string; currentAllocationUsdc?: number; sidelined?: boolean; pnlHistory?: Array<{timestamp: number; pnl: number}>; tradesCompleted?: number; sharpe?: number; maxDrawdown?: number}>)
            .find(a => a.agentId === agent.agentId);
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
        }));
      })
      .catch(() => {}); // indexer may not be running in dev
  }, []);

  useIndexerSocket(onMessage);

  const totalAllocated = agents.reduce((s, a) => s + a.allocationUsdc, 0);
  const liquidReservePct = tvl > 0 ? ((tvl - totalAllocated) / tvl) * 100 : 100;

  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">
        Themis{" "}
        <span className="text-gray-500 font-normal text-lg">· AI Agent Arena on Arc</span>
      </h1>
      <TvlBar tvlUsdc={tvl} depositCount={depositCount} />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-2 space-y-6">
          <AgentLeaderboard agents={agents.map(a => ({ ...a, totalUsdc: tvl }))} />
          <TracesFeed traces={traces} />
        </div>
        <div>
          <DepositPanel liquidReservePct={liquidReservePct} />
        </div>
      </div>
    </main>
  );
}
