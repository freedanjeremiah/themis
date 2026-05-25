/**
 * Single source of truth for per-agent display info.
 * Editorial register: agents are distinguished by name, monogram, and role,
 * not by colour. Identity is typographic, not chromatic.
 */
export type AgentId = "hermes" | "pythia" | "demeter";

export const AGENT_META: Record<AgentId, {
  name: string;
  monogram: string;      // single-letter mark for the ruled monogram box
  role: string;          // one-line desk/beat
  thesis: string;        // tooltip body
  venue: string;
}> = {
  hermes: {
    name: "Hermes",
    monogram: "H",
    role: "Funding-rate arbitrage",
    thesis: "Funding-rate arbitrage. Longs the cheap side and shorts the expensive side of perpetual funding rates.",
    venue: "Hyperliquid testnet",
  },
  pythia: {
    name: "Pythia",
    monogram: "P",
    role: "News-reactive trader",
    thesis: "News-reactive ETH/BTC perp trader. Reads Twitter and RSS, asks Claude what to do, trades the sentiment.",
    venue: "Hyperliquid testnet",
  },
  demeter: {
    name: "Demeter",
    monogram: "D",
    role: "Stablecoin yield",
    thesis: "Stablecoin yield rotator. Parks idle capital in USYC for yield while the perp agents trade.",
    venue: "USYC Teller on Arc",
  },
};

/** Neutral ink for sparkline strokes; identity is carried by name, not hue. */
export const SPARK_INK = "oklch(0.42 0.012 60)";
