import Anthropic from "@anthropic-ai/sdk";
import { AgentProposal } from "@themis/shared";
import { FundingEntry } from "./data.js";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const client = new Anthropic();

const SYSTEM = `You are Hermes, a funding-rate arbitrage trading agent on Themis.
Find the perp market with the most extreme funding rate imbalance.
Long the side paying lowest funding, short the side paying highest.

Output ONLY valid JSON with this exact shape — no markdown, no explanation outside the JSON:
{
  "agentId": "hermes",
  "tradeIdea": "<one-sentence summary of the trade>",
  "action": "long",
  "venue": "hyperliquid",
  "requestedSizeUsd": <integer 100-800>,
  "confidence": <float 0.0-1.0>,
  "reasoning": "<step-by-step chain of thought>",
  "reasoningTraceCid": "",
  "reasoningHash": "",
  "timestamp": 0
}`;

type RawProposal = AgentProposal & { reasoning: string };

export async function reason(data: FundingEntry[]): Promise<RawProposal> {
  const top5 = [...data]
    .sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate))
    .slice(0, 5);

  const call = (messages: Anthropic.MessageParam[]) =>
    client.messages.create({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, system: SYSTEM, messages });

  const strip = (s: string) => s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  const msg = await call([{ role: "user", content: `Top funding rates:\n${JSON.stringify(top5, null, 2)}` }]);
  const text = strip(msg.content[0].type === "text" ? msg.content[0].text : "");

  try {
    return JSON.parse(text);
  } catch {
    const retry = await call([
      { role: "user", content: `Top funding rates:\n${JSON.stringify(top5, null, 2)}` },
      { role: "assistant", content: text },
      { role: "user", content: "Output was not valid JSON. Output ONLY the JSON object." },
    ]);
    const retryText = strip(retry.content[0].type === "text" ? retry.content[0].text : "");
    return JSON.parse(retryText);
  }
}
