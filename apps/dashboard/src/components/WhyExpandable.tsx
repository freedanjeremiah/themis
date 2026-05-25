"use client";
import { useState } from "react";
import { useTrace } from "../hooks/useTrace";
import { TraceUnavailableError } from "../lib/ipfs";

function extractReasoning(data: unknown): string | null {
  if (data && typeof data === "object") {
    const p = (data as Record<string, unknown>).proposal as Record<string, unknown> | undefined;
    const r = (p?.reasoning ?? (data as Record<string, unknown>).reasoning) as unknown;
    if (typeof r === "string" && r.trim()) return r;
  }
  return null;
}

export function WhyExpandable({ cid }: { cid: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useTrace(cid, open);
  const reasoning = extractReasoning(data);

  return (
    <div className="mt-2.5">
      <button
        onClick={() => setOpen(o => !o)}
        className="press group inline-flex items-center gap-1.5 text-2xs font-semibold uppercase tracking-[0.1em] text-ink-3 hover:text-accent"
        aria-expanded={open}
      >
        <span className="inline-block w-2 text-ink-3 transition-transform group-hover:text-accent">{open ? "▾" : "▸"}</span>
        Reasoning
      </button>

      {open && (
        <div className="mt-2 max-w-[68ch] border-l border-ink/25 pl-3.5 animate-fade-in">
          {isLoading && <p className="text-xs italic text-ink-3">Fetching from IPFS…</p>}
          {error && (
            <p className="text-xs text-loss">
              {error instanceof TraceUnavailableError
                ? error.message
                : "Could not load trace from any IPFS gateway."}
            </p>
          )}
          {data !== undefined && !isLoading && !error && (
            reasoning ? (
              <p className="pretty font-serif text-base leading-relaxed text-ink-2">{reasoning}</p>
            ) : (
              <pre className="whitespace-pre-wrap break-words font-sans text-2xs text-ink-3">
                {JSON.stringify(data, null, 2)}
              </pre>
            )
          )}
        </div>
      )}
    </div>
  );
}
