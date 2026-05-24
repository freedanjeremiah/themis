"use client";
import { useState } from "react";
import { AGENT_META, AGENT_PILL_CLASSES, type AgentId } from "../lib/agent-meta";

const VALID_AGENT_IDS = ["hermes", "pythia", "demeter"] as const;
function isAgentId(s: string): s is AgentId {
  return (VALID_AGENT_IDS as readonly string[]).includes(s);
}

/**
 * Agent name pill with hover tooltip showing thesis + venue.
 * If the agentId is unknown, falls back to a neutral grey pill with no tooltip.
 */
export function AgentBadge({ agentId, size = "sm" }: { agentId: string; size?: "sm" | "md" }) {
  const [hover, setHover] = useState(false);
  const known = isAgentId(agentId);
  const meta = known ? AGENT_META[agentId] : null;
  const pillClass = known ? AGENT_PILL_CLASSES[agentId] : "bg-gray-700 text-gray-300";
  const sizeClass = size === "md" ? "text-sm px-3 py-1" : "text-xs px-2 py-0.5";

  return (
    <span
      className="relative inline-block"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className={`rounded ${sizeClass} ${pillClass} font-semibold uppercase tracking-wide cursor-default`}>
        {meta?.name ?? agentId}
      </span>
      {hover && meta && (
        <span className="absolute left-0 top-full mt-1 z-10 w-64 bg-gray-950 border border-gray-700 rounded p-3 text-xs text-gray-200 shadow-lg">
          <strong className="text-white">{meta.name}</strong>
          <p className="mt-1 text-gray-300">{meta.thesis}</p>
          <p className="mt-1 text-gray-500">Venue: {meta.venue}</p>
        </span>
      )}
    </span>
  );
}
