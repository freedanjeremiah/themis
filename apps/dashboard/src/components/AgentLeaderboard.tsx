"use client";
import { LineChart, Line, ResponsiveContainer, Tooltip } from "recharts";

type AgentRow = {
  agentId: string;
  allocationUsdc: number;
  totalUsdc: number;
  pnlHistory: { timestamp: number; pnl: number }[];
  sidelined: boolean;
};

const AGENT_COLORS: Record<string, string> = {
  hermes: "#60a5fa",
  pythia: "#a78bfa",
  demeter: "#34d399",
};

const AGENT_LABELS: Record<string, string> = {
  hermes: "Hermes · Funding Arb",
  pythia: "Pythia · News Reactive",
  demeter: "Demeter · Yield Rotator",
};

export function AgentLeaderboard({ agents }: { agents: AgentRow[] }) {
  const sorted = [...agents].sort((a, b) => b.allocationUsdc - a.allocationUsdc);

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
        Agent Leaderboard
      </h2>
      {sorted.map(agent => {
        const pct =
          agent.totalUsdc > 0
            ? ((agent.allocationUsdc / agent.totalUsdc) * 100).toFixed(1)
            : "0.0";
        const color = AGENT_COLORS[agent.agentId] ?? "#fff";
        return (
          <div key={agent.agentId} className="bg-gray-900 rounded-lg p-4 border border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold" style={{ color }}>
                {AGENT_LABELS[agent.agentId] ?? agent.agentId}
              </span>
              {agent.sidelined && (
                <span className="text-xs text-red-400 border border-red-600 rounded px-2 py-0.5">
                  Sidelined
                </span>
              )}
              <span className="text-xl font-mono font-bold text-white">{pct}%</span>
            </div>
            <div className="h-12">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={agent.pnlHistory.slice(-24)}>
                  <Line
                    type="monotone"
                    dataKey="pnl"
                    stroke={color}
                    dot={false}
                    strokeWidth={2}
                  />
                  <Tooltip
                    contentStyle={{ background: "#111", border: "none", fontSize: 11 }}
                    formatter={(v: number) => [`$${(v / 1e6).toFixed(4)}`, "PnL"]}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        );
      })}
    </div>
  );
}
