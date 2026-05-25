"use client";
import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useIndexerSocket } from "../hooks/useIndexerSocket";
import { TvlBar } from "../components/TvlBar";
import { CompactLeaderboard } from "../components/CompactLeaderboard";
import { ReasoningTheater } from "../components/ReasoningTheater";
import { ActivityTicker } from "../components/ActivityTicker";
import { OnboardingStrip } from "../components/OnboardingStrip";
import { DisclaimerBanner } from "../components/DisclaimerBanner";
import { type TraceItem } from "../components/TraceCard";
import type { WsMessage } from "@themis/shared";

const DepositPanel = dynamic(
  () => import("../components/DepositPanel").then(m => m.DepositPanel),
  { ssr: false, loading: () => <div className="bg-gray-900 rounded-lg p-4 border border-gray-700 h-48 animate-pulse" /> }
);

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

const INITIAL_AGENTS: AgentRow[] = [
  { agentId: "hermes",  allocationUsdc: 0, totalUsdc: 0, pnlHistory: [], sidelined: false, tradesCompleted: 0, sharpe: 0, maxDrawdown: 0 },
  { agentId: "pythia",  allocationUsdc: 0, totalUsdc: 0, pnlHistory: [], sidelined: false, tradesCompleted: 0, sharpe: 0, maxDrawdown: 0 },
  { agentId: "demeter", allocationUsdc: 0, totalUsdc: 0, pnlHistory: [], sidelined: false, tradesCompleted: 0, sharpe: 0, maxDrawdown: 0 },
];

export default function Home() {
  const [tvl, setTvl] = useState(0);
  const [depositCount, setDepositCount] = useState(0);
  const [agents, setAgents] = useState<AgentRow[]>(INITIAL_AGENTS);
  const [traces, setTraces] = useState<TraceItem[]>([]);
  const [feed, setFeed] = useState<WsMessage[]>([]);
  const [depositPrefill, setDepositPrefill] = useState<number | undefined>(undefined);
  const [prefillNonce, setPrefillNonce] = useState(0);
  const depositRef = useRef<HTMLDivElement | null>(null);

  const onMessage = useCallback((msg: WsMessage) => {
    setFeed(prev => [msg, ...prev].slice(0, 32));
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
            ? { ...a, allocationUsdc: 0, pnlHistory: [...a.pnlHistory, { timestamp: Date.now(), pnl: d.pnl }] }
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

    fetch(`${indexerUrl}/traces?limit=20`)
      .then(r => r.ok ? r.json() : null)
      .then((data: unknown) => {
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
      })
      .catch(() => {});

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
      .catch(() => {});
  }, []);

  const wsState = useIndexerSocket(onMessage);

  const totalAllocated = agents.reduce((s, a) => s + a.allocationUsdc, 0);
  const liquidReservePct = tvl > 0 ? ((tvl - totalAllocated) / tvl) * 100 : 100;

  const handleDepositPrefill = useCallback(() => {
    setDepositPrefill(10);
    setPrefillNonce(n => n + 1);
    depositRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  return (
    <>
      <DisclaimerBanner />
      <main className="max-w-5xl mx-auto p-6 space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">
            Themis{" "}
            <span className="text-gray-500 font-normal text-lg">· AI Agent Arena on Arc</span>
          </h1>
        </header>

        <TvlBar tvlUsdc={tvl} depositCount={depositCount} />

        <OnboardingStrip onDepositClick={handleDepositPrefill} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="md:col-span-2">
            <ReasoningTheater traces={traces} wsState={wsState} />
          </div>
          <div className="space-y-6">
            <CompactLeaderboard agents={agents.map(a => ({ ...a, totalUsdc: tvl }))} />
            <div ref={depositRef}>
              <DepositPanel liquidReservePct={liquidReservePct} prefilledAmount={depositPrefill} prefillNonce={prefillNonce} />
            </div>
          </div>
        </div>
      </main>

      <ActivityTicker feed={feed} />
    </>
  );
}
