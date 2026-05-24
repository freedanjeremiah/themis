/**
 * Single source of truth for per-agent display info.
 * Consumed by AgentBadge, ReasoningTheater, CompactLeaderboard, ActivityTicker.
 */
export type AgentId = "hermes" | "pythia" | "demeter";

export const AGENT_META: Record<AgentId, {
  name: string;
  color: string;         // tailwind colour token, e.g. "blue", "purple", "green"
  thesis: string;        // short tooltip body
  venue: string;
}> = {
  hermes: {
    name: "Hermes",
    color: "blue",
    thesis: "Funding-rate arbitrage — longs the cheap side and shorts the expensive side of perpetual funding rates.",
    venue: "Hyperliquid testnet (via CCTP)",
  },
  pythia: {
    name: "Pythia",
    color: "purple",
    thesis: "News-reactive ETH/BTC perp trader. Reads Twitter + RSS, asks Claude what to do, trades the sentiment.",
    venue: "Hyperliquid testnet (via CCTP)",
  },
  demeter: {
    name: "Demeter",
    color: "green",
    thesis: "Stablecoin yield rotator. Parks idle capital in USYC for yield while perp agents trade.",
    venue: "USYC Teller on Arc",
  },
};

/** Background/text class pair for the agent's small label pill (used by AgentBadge). */
export const AGENT_PILL_CLASSES: Record<AgentId, string> = {
  hermes: "bg-blue-900 text-blue-300",
  pythia: "bg-purple-900 text-purple-300",
  demeter: "bg-green-900 text-green-300",
};
