"use client";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { PageHead } from "../../components/PageHead";
import { useThemisData, type AgentRow } from "../../components/DataProvider";
import { AGENT_META, SPARK_INK, type AgentId } from "../../lib/agent-meta";

const PLAIN: Record<AgentId, string> = {
  hermes:
    "Hermes hunts funding-rate gaps. When traders pay a premium to hold one side of a perpetual future, it takes the cheap side and shorts the expensive one, capturing the spread while staying roughly market-neutral.",
  pythia:
    "Pythia reads the news. It pulls headlines from Twitter and RSS, asks Claude what they mean for ETH and BTC, and takes a directional position only when the sentiment is strong enough to act on.",
  demeter:
    "Demeter keeps idle cash working. Instead of chasing trades, it rotates the pool's spare USDC into USYC, a tokenized treasury product, to earn a steady yield with no directional risk.",
};

function statusOf(a: AgentRow): { text: string; tone: string } {
  if (a.sidelined) return { text: "Sidelined for the day", tone: "text-loss" };
  if (a.allocationUsdc > 0) return { text: "Holding a position", tone: "text-accent" };
  return { text: "Idle, awaiting next cycle", tone: "text-ink-3" };
}

export default function AgentsPage() {
  const { agents } = useThemisData();
  const ranked = [...agents].sort((a, b) => b.cumPnlRaw - a.cumPnlRaw);

  return (
    <div>
      <PageHead title="The Agents" intro="Three autonomous traders, each with its own strategy, venue, and track record. Ranked here by return this session." />

      <div className="divide-y divide-ink/12">
        {ranked.map((a, rank) => {
          const id = a.agentId as AgentId;
          const meta = AGENT_META[id];
          if (!meta) return null;
          const up = a.returnPct >= 0;
          const status = statusOf(a);
          const spark = a.pnlHistory.slice(-32).map((p, i) => ({ i, pnl: p.pnl }));

          return (
            <article key={a.agentId} className="grid gap-5 py-7 md:grid-cols-[1.6fr_1fr]">
              <div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-9 w-9 items-center justify-center border border-ink/30 font-serif text-lg font-semibold text-ink">
                    {meta.monogram}
                  </span>
                  <div>
                    <h2 className="font-serif text-xl font-semibold leading-none text-ink">{meta.name}</h2>
                    <p className="label mt-1">{meta.role}</p>
                  </div>
                  <span className="ml-auto font-serif text-sm tnum text-ink-3">No. {rank + 1}</span>
                </div>
                <p className="pretty mt-3 max-w-[58ch] text-base leading-relaxed text-ink-2">{PLAIN[id]}</p>
                <p className="mt-3 text-xs">
                  <span className="label">Venue</span>{" "}
                  <span className="text-ink-2">{meta.venue}</span>
                  <span className="mx-2 text-ink/25">·</span>
                  <span className={status.tone}>{status.text}</span>
                </p>
              </div>

              {/* Track record */}
              <div className="flex flex-col justify-between gap-3 md:border-l md:border-ink/12 md:pl-5">
                <div className="flex items-baseline justify-between">
                  <span className="label">Return</span>
                  <span className={`font-serif text-2xl tnum ${up ? "text-gain" : "text-loss"}`}>
                    {up ? "+" : "−"}{Math.abs(a.returnPct).toFixed(2)}%
                  </span>
                </div>
                <div className="h-12">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={spark}>
                      <Line type="monotone" dataKey="pnl" stroke={SPARK_INK} strokeWidth={1.25} dot={false} isAnimationActive animationDuration={750} animationEasing="ease-out" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex justify-between text-xs">
                  <span>
                    <span className="label">Sharpe </span>
                    {a.tradesCompleted < 10
                      ? <span className="text-warn">warming up</span>
                      : <span className="tnum text-ink-2">{a.sharpe.toFixed(2)}</span>}
                  </span>
                  <span><span className="label">Trades </span><span className="tnum text-ink-2">{a.tradesCompleted}</span></span>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <p className="pretty mt-2 max-w-[60ch] text-xs italic text-ink-3">
        Return is measured against each agent's $10 seed allocation. Sharpe shows after ten settled trades; before that an agent is still warming up.
      </p>
    </div>
  );
}
