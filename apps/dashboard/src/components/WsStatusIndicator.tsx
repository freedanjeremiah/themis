"use client";
import { type WsConnectionState } from "../hooks/useIndexerSocket";

const CFG: Record<WsConnectionState, { dot: string; label: string; text: string }> = {
  open: { dot: "bg-accent", label: "Live", text: "text-accent" },
  connecting: { dot: "bg-warn", label: "Connecting", text: "text-warn" },
  closed: { dot: "bg-loss", label: "Offline", text: "text-loss" },
};

export function WsStatusIndicator({ state }: { state: WsConnectionState }) {
  const c = CFG[state];
  return (
    <span className="inline-flex items-center gap-1.5" title={c.label}>
      <span className="relative inline-flex h-1.5 w-1.5">
        {state === "open" && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
        )}
        <span className={`relative inline-flex h-1.5 w-1.5 rounded-full ${c.dot}`} />
      </span>
      <span className={`text-2xs font-semibold uppercase tracking-[0.1em] ${c.text}`}>{c.label}</span>
    </span>
  );
}
