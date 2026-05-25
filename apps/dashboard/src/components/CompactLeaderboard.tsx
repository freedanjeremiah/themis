"use client";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { AgentBadge } from "./AgentBadge";
import { SPARK_INK } from "../lib/agent-meta";

type AgentRow = {
  agentId: string;
  allocationUsdc: number;
  totalUsdc: number;
  pnlHistory: { timestamp: number; pnl: number }[];
  sidelined: boolean;
  tradesCompleted: number;
  sharpe: number;
};

const DEPOSIT_RAW = 10_000_000; // $10 seed per agent, raw USDC (6 decimals)

export function CompactLeaderboard({ agents }: { agents: AgentRow[] }) {
  const sorted = agents
    .map(a => ({ ...a, cumPnlRaw: a.pnlHistory.reduce((s, p) => s + p.pnl, 0) }))
    .sort((a, b) => b.cumPnlRaw - a.cumPnlRaw);

  return (
    <section>
      <div className="flex items-baseline justify-between border-b-2 border-ink pb-2">
        <h2 className="font-serif text-xl font-semibold tracking-tight text-ink">Standings</h2>
        <span className="label">by return</span>
      </div>

      <div className="divide-y divide-ink/12">
        {sorted.map((agent, rank) => {
          const pctNum = (agent.cumPnlRaw / DEPOSIT_RAW) * 100;
          const up = pctNum >= 0;
          const spark = agent.pnlHistory.slice(-24).map((p, i) => ({ i, pnl: p.pnl }));

          return (
            <div key={agent.agentId} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <span className="w-3 font-serif text-sm tnum text-ink-3">{rank + 1}</span>
                  <AgentBadge agentId={agent.agentId} />
                  {agent.sidelined && (
                    <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-loss">sidelined</span>
                  )}
                </div>
                <span className={`font-serif text-lg tnum ${up ? "text-gain" : "text-loss"}`}>
                  {up ? "+" : "−"}{Math.abs(pctNum).toFixed(2)}%
                </span>
              </div>

              <div className="mt-1.5 flex items-center gap-3 pl-[1.375rem]">
                <div className="h-7 flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={spark}>
                      <Line type="monotone" dataKey="pnl" stroke={SPARK_INK} strokeWidth={1.25} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <span className="shrink-0 text-2xs uppercase tracking-[0.06em] text-ink-3">
                  {agent.tradesCompleted < 10 ? "warming up" : <>Sharpe <span className="tnum text-ink-2">{agent.sharpe.toFixed(2)}</span></>}
                  <span className="mx-1.5 text-ink/25">·</span>
                  <span className="tnum text-ink-2">{agent.tradesCompleted}</span> trades
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
