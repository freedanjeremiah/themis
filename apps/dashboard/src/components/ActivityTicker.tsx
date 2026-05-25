"use client";
import { useEffect, useState } from "react";
import { type WsMessage } from "@themis/shared";
import { AGENT_META } from "../lib/agent-meta";

const MAX = 12;

type Kind = "deposit" | "allocation" | "settlement" | "trace";
type TickerEvent = { id: number; text: string; kind: Kind; positive?: boolean };

let nextId = 1;

function formatEvent(msg: WsMessage): Omit<TickerEvent, "id"> | null {
  if (msg.event === "deposit") {
    const d = msg.data as { wallet: string; amount: number };
    return { kind: "deposit", text: `New depositor ${d.wallet.slice(0, 6)}…${d.wallet.slice(-4)}, $${(d.amount / 1e6).toFixed(2)}` };
  }
  if (msg.event === "allocation") {
    const d = msg.data as { agentId: string; amount: number };
    const name = AGENT_META[d.agentId as keyof typeof AGENT_META]?.name ?? d.agentId;
    return { kind: "allocation", text: `${name} allocated $${(d.amount / 1e6).toFixed(2)}` };
  }
  if (msg.event === "settlement") {
    const d = msg.data as { agentId: string; pnl: number };
    const name = AGENT_META[d.agentId as keyof typeof AGENT_META]?.name ?? d.agentId;
    const pnlUsd = d.pnl / 1e6;
    return { kind: "settlement", positive: pnlUsd >= 0, text: `${name} settled ${pnlUsd >= 0 ? "+" : "−"}$${Math.abs(pnlUsd).toFixed(2)}` };
  }
  if (msg.event === "trace") {
    const d = msg.data as { agentId: string; tradeIdea: string };
    const name = AGENT_META[d.agentId as keyof typeof AGENT_META]?.name ?? d.agentId;
    return { kind: "trace", text: `${name} proposed: ${d.tradeIdea}` };
  }
  return null;
}

function Item({ e }: { e: TickerEvent }) {
  const tone = e.kind === "settlement" ? (e.positive ? "text-gain" : "text-loss") : "text-ink-2";
  return (
    <span className="mr-8 inline-flex items-center gap-2 text-xs">
      <span className="h-1 w-1 rounded-full bg-ink/30" />
      <span className={tone}>{e.text}</span>
    </span>
  );
}

export function ActivityTicker({ feed }: { feed: WsMessage[] }) {
  const [events, setEvents] = useState<TickerEvent[]>([]);

  useEffect(() => {
    if (feed.length === 0) return;
    const f = formatEvent(feed[0]);
    if (!f) return;
    setEvents(prev => [{ id: nextId++, ...f }, ...prev].slice(0, MAX));
  }, [feed]);

  if (events.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink bg-paper">
      <div className="mx-auto flex max-w-6xl items-center px-5 py-2">
        <span className="label shrink-0 pr-4">On the wire</span>
        <div
          className="marquee relative flex-1 overflow-hidden"
          style={{
            WebkitMaskImage: "linear-gradient(to right, transparent, #000 2rem, #000 calc(100% - 2rem), transparent)",
            maskImage: "linear-gradient(to right, transparent, #000 2rem, #000 calc(100% - 2rem), transparent)",
          }}
        >
          <div className="marquee-track whitespace-nowrap">
            {events.map(e => <Item key={e.id} e={e} />)}
            {events.map(e => <Item key={`dup-${e.id}`} e={e} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
