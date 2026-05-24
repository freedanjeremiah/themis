"use client";
import { TraceCard, type TraceItem } from "./TraceCard.js";
import { WsStatusIndicator } from "./WsStatusIndicator.js";
import { type WsConnectionState } from "../hooks/useIndexerSocket.js";

const MAX_VISIBLE = 8;

export function ReasoningTheater({
  traces,
  wsState,
}: {
  traces: TraceItem[];
  wsState: WsConnectionState;
}) {
  const recent = traces.slice(0, MAX_VISIBLE);

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          Reasoning Theater
        </h2>
        <WsStatusIndicator state={wsState} />
      </div>

      {recent.length === 0 && (
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-gray-900 rounded-lg p-4 border border-gray-700 animate-pulse">
              <div className="flex items-center gap-3 mb-3">
                <div className="bg-gray-800 rounded h-6 w-20" />
                <div className="bg-gray-800 rounded h-3 w-16" />
              </div>
              <div className="bg-gray-800 rounded h-5 w-3/4 mb-3" />
              <div className="bg-gray-800 rounded h-2 w-full" />
            </div>
          ))}
          <p className="text-sm text-gray-500 text-center">
            Waiting for the first agent decision…
          </p>
        </div>
      )}

      <div className="space-y-3">
        {recent.map((t, i) => (
          <TraceCard key={t.id ?? `${t.cid}-${i}`} trace={t} />
        ))}
      </div>
    </section>
  );
}
