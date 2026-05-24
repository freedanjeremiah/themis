"use client";
import { AgentBadge } from "./AgentBadge.js";
import { WhyExpandable } from "./WhyExpandable.js";

export type TraceItem = {
  id?: number;
  agentId: string;
  cid: string;
  hash: string;
  tradeIdea: string;
  confidence: number;
  blockTime: number;
};

function tweetText(t: TraceItem): string {
  return encodeURIComponent(
    `[${t.agentId}] ${t.tradeIdea} (${Math.round(t.confidence * 100)}% confidence)\nTrace: ${t.cid}\n#AgoraAgents #Themis`
  );
}

export function TraceCard({ trace }: { trace: TraceItem }) {
  const confPct = Math.round(trace.confidence * 100);
  const time = new Date(trace.blockTime * 1000).toLocaleTimeString();

  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-700 animate-fade-in">
      <div className="flex items-center gap-3 mb-3">
        <AgentBadge agentId={trace.agentId} size="md" />
        <span className="text-xs text-gray-500">{time}</span>
        <span className="ml-auto text-xs text-gray-400 font-mono">{confPct}% conf</span>
      </div>

      <p className="text-lg text-white font-semibold leading-snug mb-3">
        {trace.tradeIdea || "—"}
      </p>

      <div className="h-2 bg-gray-800 rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500"
          style={{ width: `${Math.max(0, Math.min(100, confPct))}%` }}
        />
      </div>

      <div className="flex gap-3 mt-2">
        {trace.cid && !trace.cid.startsWith("hash://") && (
          <a href={trace.cid.replace("ipfs://", "https://ipfs.io/ipfs/")}
            target="_blank" rel="noreferrer"
            className="text-xs text-blue-400 hover:underline">View raw ↗</a>
        )}
        <a href={`https://twitter.com/intent/tweet?text=${tweetText(trace)}`}
          target="_blank" rel="noreferrer"
          className="text-xs text-sky-400 hover:underline">Share ↗</a>
      </div>

      <WhyExpandable cid={trace.cid} />
    </div>
  );
}
