"use client";

type TraceItem = {
  id?: number;
  agentId: string;
  cid: string;
  hash: string;
  tradeIdea: string;
  confidence: number;
  blockTime: number;
};

const AGENT_COLORS: Record<string, string> = {
  hermes: "bg-blue-900 text-blue-300",
  pythia: "bg-purple-900 text-purple-300",
  demeter: "bg-green-900 text-green-300",
};

function tweetText(trace: TraceItem): string {
  return encodeURIComponent(
    `[${trace.agentId}] ${trace.tradeIdea} (${Math.round(trace.confidence * 100)}% confidence)\nTrace: ${trace.cid}\n#AgoraAgents #Themis`
  );
}

export function TracesFeed({ traces }: { traces: TraceItem[] }) {
  return (
    <div className="space-y-2">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
        Recent Decisions
      </h2>
      {traces.map((t, i) => (
        <div key={t.id ?? i} className="bg-gray-900 rounded-lg p-3 border border-gray-700">
          <div className="flex items-center gap-2 mb-1">
            <span className={`text-xs rounded px-2 py-0.5 ${AGENT_COLORS[t.agentId] ?? "bg-gray-700 text-gray-300"}`}>
              {t.agentId}
            </span>
            <span className="text-xs text-gray-500">
              {new Date(t.blockTime * 1000).toLocaleTimeString()}
            </span>
            <span className="ml-auto text-xs text-gray-400">
              {Math.round(t.confidence * 100)}% conf
            </span>
          </div>
          <p className="text-sm text-white">{t.tradeIdea || "—"}</p>
          <div className="flex gap-3 mt-2">
            {t.cid && !t.cid.startsWith("hash://") && (
              <a
                href={t.cid.replace("ipfs://", "https://ipfs.io/ipfs/")}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-blue-400 hover:underline"
              >
                View trace ↗
              </a>
            )}
            <a
              href={`https://twitter.com/intent/tweet?text=${tweetText(t)}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-sky-400 hover:underline"
            >
              Share ↗
            </a>
          </div>
        </div>
      ))}
      {traces.length === 0 && (
        <p className="text-sm text-gray-600 text-center py-8">Waiting for agent decisions...</p>
      )}
    </div>
  );
}
