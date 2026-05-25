"use client";
import { useEffect, useRef } from "react";
import { TraceCard, type TraceItem } from "./TraceCard";

const MAX_VISIBLE = 8;

/** The dispatch feed: a ruled column of agent decisions. Header supplied by the page.
 *  The newest dispatch "prints in" when it arrives (not on initial load). */
export function ReasoningTheater({ traces }: { traces: TraceItem[] }) {
  const recent = traces.slice(0, MAX_VISIBLE);
  const seenTop = useRef<number | string | null>(null);

  const topId = recent[0]?.id ?? recent[0]?.cid ?? null;
  // Fresh only when we've already seen a different top before (i.e. a new arrival,
  // not the first paint).
  const freshId = seenTop.current !== null && topId !== seenTop.current ? topId : null;

  useEffect(() => { seenTop.current = topId; }, [topId]);

  if (recent.length === 0) {
    return (
      <div className="divide-y divide-ink/12">
        {[0, 1, 2].map(i => (
          <div key={i} className="py-5">
            <div className="flex items-center gap-3">
              <div className="skeleton h-6 w-6" />
              <div className="skeleton h-3.5 w-24" />
              <div className="skeleton ml-auto h-6 w-10" />
            </div>
            <div className="skeleton mt-3 h-5 w-3/4" />
          </div>
        ))}
        <p className="py-5 font-serif text-base italic text-ink-3">Waiting for the first dispatch.</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-ink/12">
      {recent.map((t, i) => {
        const id = t.id ?? t.cid;
        return <TraceCard key={t.id ?? `${t.cid}-${i}`} trace={t} fresh={id === freshId} />;
      })}
    </div>
  );
}
