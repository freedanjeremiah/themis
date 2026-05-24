"use client";
import { useEffect, useState } from "react";
import { type WsMessage } from "@themis/shared";
import { AGENT_META } from "../lib/agent-meta.js";

const MAX = 8;

type TickerEvent = {
  id: number;        // monotonic local id
  ts: number;
  text: string;
};

let nextId = 1;

function formatEvent(msg: WsMessage): string | null {
  if (msg.event === "deposit") {
    const d = msg.data as { wallet: string; amount: number };
    return `New depositor: ${d.wallet.slice(0, 6)}…${d.wallet.slice(-4)} · $${(d.amount / 1e6).toFixed(2)} deposited`;
  }
  if (msg.event === "allocation") {
    const d = msg.data as { agentId: string; amount: number };
    const name = AGENT_META[d.agentId as keyof typeof AGENT_META]?.name ?? d.agentId;
    return `${name} allocated $${(d.amount / 1e6).toFixed(2)}`;
  }
  if (msg.event === "settlement") {
    const d = msg.data as { agentId: string; pnl: number };
    const name = AGENT_META[d.agentId as keyof typeof AGENT_META]?.name ?? d.agentId;
    const pnlUsd = d.pnl / 1e6;
    const sign = pnlUsd >= 0 ? "+" : "";
    return `${name} settled ${sign}$${pnlUsd.toFixed(2)}`;
  }
  if (msg.event === "trace") {
    const d = msg.data as { agentId: string; tradeIdea: string };
    const name = AGENT_META[d.agentId as keyof typeof AGENT_META]?.name ?? d.agentId;
    return `${name} proposed: ${d.tradeIdea}`;
  }
  return null;
}

function relativeTime(ts: number): string {
  const sec = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  return `${min}m ago`;
}

export function ActivityTicker({ feed }: { feed: WsMessage[] }) {
  const [events, setEvents] = useState<TickerEvent[]>([]);
  const [, forceTick] = useState(0);

  // When new WS messages arrive, prepend formatted entries.
  useEffect(() => {
    if (feed.length === 0) return;
    const newest = feed[0];
    const text = formatEvent(newest);
    if (!text) return;
    setEvents(prev => [{ id: nextId++, ts: Date.now(), text }, ...prev].slice(0, MAX));
  }, [feed]);

  // Tick every 5s to refresh relative-time strings.
  useEffect(() => {
    const t = setInterval(() => forceTick(x => x + 1), 5_000);
    return () => clearInterval(t);
  }, []);

  if (events.length === 0) return null;

  return (
    <div className="fixed bottom-0 inset-x-0 bg-gray-950 border-t border-gray-800 px-4 py-2 text-xs text-gray-300 overflow-hidden">
      <div className="max-w-5xl mx-auto flex items-center gap-6 overflow-x-auto whitespace-nowrap">
        {events.map((e, i) => (
          <span
            key={e.id}
            className="inline-flex items-center gap-2 transition-opacity duration-700"
            style={{ opacity: 1 - (i / MAX) * 0.6 }}
          >
            <span className="text-gray-400">→</span>
            <span>{e.text}</span>
            <span className="text-gray-600">· {relativeTime(e.ts)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
