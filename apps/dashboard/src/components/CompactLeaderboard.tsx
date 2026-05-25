"use client";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { AgentBadge } from "./AgentBadge";

type AgentRow = {
  agentId: string;
  allocationUsdc: number;
  totalUsdc: number;
  pnlHistory: { timestamp: number; pnl: number }[];
  sidelined: boolean;
  tradesCompleted: number;
  sharpe: number;
};

const SPARK_COLOR: Record<string, string> = {
  hermes: "#60a5fa",
  pythia: "#a78bfa",
  demeter: "#34d399",
};

const DEPOSIT_RAW = 10_000_000; // $10 per agent in raw USDC (6 decimals)

export function CompactLeaderboard({ agents }: { agents: AgentRow[] }) {
  const withPnl = agents.map(a => ({
    ...a,
    cumPnlRaw: a.pnlHistory.reduce((s, p) => s + p.pnl, 0),
  }));
  const sorted = [...withPnl].sort((a, b) => b.cumPnlRaw - a.cumPnlRaw);

  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
        Leaderboard
      </h2>
      {sorted.map(agent => {
        const pct = ((agent.cumPnlRaw / DEPOSIT_RAW) * 100).toFixed(2);
        const pctNum = agent.cumPnlRaw / DEPOSIT_RAW * 100;
        const sparkColor = SPARK_COLOR[agent.agentId] ?? "#fff";

        return (
          <div key={agent.agentId}
            className="bg-gray-900 rounded-lg p-3 border border-gray-700">
            <div className="flex items-center justify-between mb-1">
              <AgentBadge agentId={agent.agentId} />
              <div className="flex items-center gap-2">
                {agent.sidelined && (
                  <span className="text-[10px] text-red-400 border border-red-600 rounded px-1.5 py-0.5">
                    Sidelined
                  </span>
                )}
                <span className={`text-base font-mono font-bold ${pctNum >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {pctNum >= 0 ? "+" : ""}{pct}%
                </span>
              </div>
            </div>
            <div className="flex justify-between text-[11px] text-gray-400 mb-1">
              <span>
                Sharpe:{" "}
                {agent.tradesCompleted < 10
                  ? <span className="text-yellow-500">boot</span>
                  : <span className="text-white font-mono">{agent.sharpe.toFixed(2)}</span>}
              </span>
              <span>Trades: <span className="text-white font-mono">{agent.tradesCompleted}</span></span>
            </div>
            <div className="h-8 -mx-1">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={agent.pnlHistory.slice(-24)}>
                  <Line type="monotone" dataKey="pnl" stroke={sparkColor} dot={false} strokeWidth={1.5} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </section>
  );
}
