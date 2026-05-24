"use client";
import { type WsConnectionState } from "../hooks/useIndexerSocket";

const DOT_CLASS: Record<WsConnectionState, string> = {
  open: "bg-green-500",
  connecting: "bg-yellow-500 animate-pulse",
  closed: "bg-red-500",
};

const LABEL: Record<WsConnectionState, string> = {
  open: "Live",
  connecting: "Connecting…",
  closed: "Disconnected",
};

export function WsStatusIndicator({ state }: { state: WsConnectionState }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-gray-400" title={LABEL[state]}>
      <span className={`inline-block w-2 h-2 rounded-full ${DOT_CLASS[state]}`} />
      <span>{LABEL[state]}</span>
    </span>
  );
}
