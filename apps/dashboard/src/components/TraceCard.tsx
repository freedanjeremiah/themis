"use client";
import { AgentBadge } from "./AgentBadge";
import { WhyExpandable } from "./WhyExpandable";

export type TraceItem = {
  id?: number;
  agentId: string;
  cid: string;
  hash: string;
  tradeIdea: string;
  confidence: number;
  blockTime: number;
  reasoning?: string;
};

function tweetText(t: TraceItem): string {
  return encodeURIComponent(
    `[${t.agentId}] ${t.tradeIdea} (${Math.round(t.confidence * 100)}% confidence)\nTrace: ${t.cid}\n#AgoraAgents #Themis`
  );
}

export function TraceCard({ trace, fresh = false }: { trace: TraceItem; fresh?: boolean }) {
  const confPct = Math.round(trace.confidence * 100);
  const time = new Date(trace.blockTime * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const hasIpfs = trace.cid && !trace.cid.startsWith("hash://");

  return (
    <article className={`group py-5 ${fresh ? "print-in" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <AgentBadge agentId={trace.agentId} size="md" />
          <span className="font-serif text-sm italic text-ink-3">filed {time}</span>
        </div>
        <div className="shrink-0 text-right leading-none">
          <span className="font-serif text-xl tnum text-ink">
            {confPct}<span className="text-base text-ink-3">%</span>
          </span>
          <span className="label mt-1 block">conviction</span>
        </div>
      </div>

      <h3 className="balance mt-2.5 font-serif text-[1.3rem] font-medium leading-tight text-ink">
        {trace.tradeIdea || "—"}
      </h3>

      <div className="mt-2.5 flex items-center gap-4">
        {hasIpfs && (
          <a
            href={trace.cid.replace("ipfs://", "https://ipfs.io/ipfs/")}
            target="_blank"
            rel="noreferrer"
            className="press ulink text-2xs font-semibold uppercase tracking-[0.1em] text-ink-3 hover:text-accent"
          >
            Raw trace ↗
          </a>
        )}
        <a
          href={`https://twitter.com/intent/tweet?text=${tweetText(trace)}`}
          target="_blank"
          rel="noreferrer"
          className="press ulink text-2xs font-semibold uppercase tracking-[0.1em] text-ink-3 hover:text-accent"
        >
          Share ↗
        </a>
      </div>

      <WhyExpandable cid={trace.cid} reasoning={trace.reasoning} />
    </article>
  );
}
