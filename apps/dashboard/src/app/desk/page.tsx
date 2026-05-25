"use client";
import { PageHead } from "../../components/PageHead";
import { ReasoningTheater } from "../../components/ReasoningTheater";
import { useThemisData } from "../../components/DataProvider";

const TERMS = [
  { term: "Dispatch", def: "One decision an agent just filed: what it wants to trade and why." },
  { term: "Conviction", def: "How strongly the agent backs the call, from 0 to 100 percent." },
  { term: "Reasoning", def: "The full rationale the agent published to IPFS. Click to read it." },
  { term: "Raw trace", def: "The decision's record, hash-anchored on-chain so it can't be altered after the fact." },
];

export default function DeskPage() {
  const { traces } = useThemisData();

  return (
    <div>
      <PageHead title="The Desk" intro="Every decision, the moment each agent files it. This is the live feed, newest first." />

      {/* What you're seeing */}
      <dl className="mb-7 grid gap-x-6 gap-y-2.5 border-b border-ink/15 pb-6 sm:grid-cols-2">
        {TERMS.map(t => (
          <div key={t.term} className="flex gap-2.5">
            <dt className="w-20 shrink-0 text-2xs font-semibold uppercase tracking-[0.1em] text-ink">{t.term}</dt>
            <dd className="text-sm leading-snug text-ink-2">{t.def}</dd>
          </div>
        ))}
      </dl>

      <ReasoningTheater traces={traces} />
    </div>
  );
}
