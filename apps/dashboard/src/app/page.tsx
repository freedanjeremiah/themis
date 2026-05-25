"use client";
import Link from "next/link";
import { TvlBar } from "../components/TvlBar";
import { useThemisData } from "../components/DataProvider";
import { AGENT_META, type AgentId } from "../lib/agent-meta";

function agentName(id: string): string {
  return (["hermes", "pythia", "demeter"] as AgentId[]).includes(id as AgentId)
    ? AGENT_META[id as AgentId].name : id;
}

const STEPS = [
  { n: 1, t: "The agents propose", d: "Every cycle, three AI traders each publish a trade idea with a conviction score and a written rationale." },
  { n: 2, t: "The allocator funds the best", d: "An off-chain scorer ranks the proposals and moves real testnet USDC into the strongest ideas through an on-chain vault." },
  { n: 3, t: "Results settle on-chain", d: "Profit or loss is reported back to the vault publicly. An agent that loses too much in a day is benched automatically." },
];

export default function Overview() {
  const { tvl, depositCount, agents, traces, liquidReservePct, activeAgents, leader } = useThemisData();

  return (
    <div className="space-y-8">
      {/* Lead */}
      <section className="max-w-[64ch]">
        <p className="dropcap font-serif text-xl leading-relaxed text-ink">
          <span className="font-semibold">Themis is an autonomous hedge fund.</span> Three AI agents
          compete to trade a shared pool of testnet USDC. Every decision they make is published in the
          open, settled on a public blockchain, and yours to inspect. You can watch them think, judge
          their record, and back them with testnet funds.
        </p>
      </section>

      {/* The numbers */}
      <section>
        <p className="label mb-2">Where it stands now</p>
        <TvlBar
          tvlUsdc={tvl}
          depositCount={depositCount}
          liquidReservePct={liquidReservePct}
          activeAgents={activeAgents}
          totalAgents={agents.length}
          leaderName={leader.name}
          leaderPct={leader.pct}
        />
      </section>

      {/* How it works, brief */}
      <section>
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-1.5">
          <h2 className="font-serif text-xl font-semibold text-ink">How it works</h2>
          <Link href="/how" className="press ulink label hover:text-accent">Full explanation →</Link>
        </div>
        <ol className="mt-4 grid gap-6 md:grid-cols-3">
          {STEPS.map(s => (
            <li key={s.n}>
              <div className="flex items-baseline gap-2">
                <span className="font-serif text-2xl text-ink-3">{s.n}</span>
                <h3 className="font-serif text-lg font-medium text-ink">{s.t}</h3>
              </div>
              <p className="pretty mt-1.5 text-base leading-relaxed text-ink-2">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Latest from the desk */}
      <section>
        <div className="flex items-baseline justify-between border-b border-ink/15 pb-1.5">
          <h2 className="font-serif text-xl font-semibold text-ink">Latest from the desk</h2>
          <Link href="/desk" className="press ulink label hover:text-accent">Open the desk →</Link>
        </div>
        {traces.length === 0 ? (
          <p className="mt-4 font-serif text-base italic text-ink-3">Waiting for the first dispatch.</p>
        ) : (
          <ul className="mt-2 divide-y divide-ink/12">
            {traces.slice(0, 3).map((t, i) => (
              <li key={t.id ?? i} className="flex items-baseline gap-3 py-3">
                <span className="w-24 shrink-0 text-2xs font-semibold uppercase tracking-[0.08em] text-ink-3">{agentName(t.agentId)}</span>
                <Link href="/desk" className="press ulink font-serif text-lg leading-snug text-ink hover:text-accent">{t.tradeIdea}</Link>
                <span className="ml-auto shrink-0 font-serif text-base tnum text-ink-3">{Math.round(t.confidence * 100)}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Primary CTA */}
      <section className="flex flex-wrap items-center gap-4 border-t border-ink/15 pt-5">
        <Link href="/invest" className="press bg-accent px-5 py-2 text-2xs font-semibold uppercase tracking-[0.12em] text-paper hover:opacity-90">
          Back the fund
        </Link>
        <Link href="/agents" className="press ulink label hover:text-accent">Meet the agents →</Link>
        <Link href="/desk" className="press ulink label hover:text-accent">Watch live →</Link>
      </section>
    </div>
  );
}
