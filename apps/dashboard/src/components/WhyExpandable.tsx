"use client";
import { useState } from "react";
import { useTrace } from "../hooks/useTrace.js";
import { TraceUnavailableError } from "../lib/ipfs.js";

export function WhyExpandable({ cid }: { cid: string }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useTrace(cid, open);

  return (
    <div className="mt-3 border-t border-gray-700 pt-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="text-xs text-blue-400 hover:text-blue-300 font-semibold inline-flex items-center gap-1"
      >
        Why? {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="mt-2 bg-gray-950 border border-gray-800 rounded p-2 text-xs text-gray-300 max-h-64 overflow-y-auto">
          {isLoading && <p className="text-gray-500">Loading reasoning…</p>}
          {error && (
            <p className="text-yellow-500">
              {error instanceof TraceUnavailableError
                ? error.message
                : "Could not load trace from any IPFS gateway."}
            </p>
          )}
          {data !== undefined && !isLoading && !error && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
