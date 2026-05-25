"use client";
import { useState } from "react";
import { AGENT_META, type AgentId } from "../lib/agent-meta";

const VALID_AGENT_IDS = ["hermes", "pythia", "demeter"] as const;
function isAgentId(s: string): s is AgentId {
  return (VALID_AGENT_IDS as readonly string[]).includes(s);
}

/**
 * Editorial byline: a ruled serif monogram + the agent's name in small caps,
 * with a hover tooltip (role, thesis, venue). Identity is typographic, not colour.
 */
export function AgentBadge({ agentId, size = "sm" }: { agentId: string; size?: "sm" | "md" }) {
  const [hover, setHover] = useState(false);
  const known = isAgentId(agentId);
  const meta = known ? AGENT_META[agentId] : null;
  const name = meta?.name ?? agentId;
  const mono = meta?.monogram ?? name.charAt(0).toUpperCase();

  const box = size === "md" ? "h-6 w-6 text-sm" : "h-5 w-5 text-xs";
  const nameCls = size === "md" ? "text-sm" : "text-xs";

  return (
    <span
      className="relative inline-flex items-center gap-2"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className={`inline-flex shrink-0 items-center justify-center border border-ink/30 font-serif font-semibold text-ink ${box}`}>
        {mono}
      </span>
      <span className={`font-semibold uppercase tracking-[0.08em] text-ink ${nameCls}`}>{name}</span>

      {hover && meta && (
        <span className="absolute left-0 top-full z-30 mt-2 w-72 border border-ink/20 bg-paper-2 p-3 text-xs shadow-[0_8px_24px_-12px_rgba(0,0,0,0.35)] animate-fade-in">
          <span className="flex items-center gap-2">
            <span className="inline-flex h-5 w-5 items-center justify-center border border-ink/30 font-serif text-xs font-semibold text-ink">{mono}</span>
            <strong className="font-serif text-sm text-ink">{meta.name}</strong>
            <span className="label ml-auto">{meta.role}</span>
          </span>
          <p className="pretty mt-2 leading-relaxed text-ink-2">{meta.thesis}</p>
          <p className="mt-1.5 text-2xs text-ink-3">Venue · {meta.venue}</p>
        </span>
      )}
    </span>
  );
}
