import Anthropic from "@anthropic-ai/sdk";
import { AgentProposal } from "@themis/shared";
import { NewsItem } from "./data.js";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const client = new Anthropic();

const SYSTEM = `You are Pythia, a news-reactive ETH/BTC trading agent on Themis.
Analyze recent crypto headlines and determine directional market sentiment.
Trade ETH-PERP or BTC-PERP on Hyperliquid based on what you read.

Output ONLY valid JSON — no markdown, no text outside JSON:
{
  "agentId": "pythia",
  "tradeIdea": "<one-sentence trade + headline that triggered it>",
  "action": "long" | "short" | "hold",
  "venue": "hyperliquid",
  "requestedSizeUsd": <integer 100-800>,
  "confidence": <float 0.0-1.0>,
  "reasoning": "<cite specific headlines, explain sentiment, state trade logic>",
  "reasoningTraceCid": "",
  "reasoningHash": "",
  "timestamp": 0
}`;

type RawProposal = AgentProposal & { reasoning: string };

export async function reason(news: NewsItem[]): Promise<RawProposal> {
  const call = (messages: Anthropic.MessageParam[]) =>
    client.messages.create({ model: "claude-haiku-4-5-20251001", max_tokens: 1024, system: SYSTEM, messages });

  const strip = (s: string) => s.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  const msg = await call([{ role: "user", content: `Recent headlines:\n${JSON.stringify(news, null, 2)}` }]);
  const text = strip(msg.content[0].type === "text" ? msg.content[0].text : "");

  try {
    return JSON.parse(text);
  } catch {
    const retry = await call([
      { role: "user", content: `Recent headlines:\n${JSON.stringify(news, null, 2)}` },
      { role: "assistant", content: text },
      { role: "user", content: "Output was not valid JSON. Output ONLY the JSON object." },
    ]);
    const retryText = strip(retry.content[0].type === "text" ? retry.content[0].text : "");
    return JSON.parse(retryText);
  }
}
