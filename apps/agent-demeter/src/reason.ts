import Anthropic from "@anthropic-ai/sdk";
import { AgentProposal } from "@themis/shared";
import { YieldData } from "./data.js";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const client = new Anthropic();

const SYSTEM = `You are Demeter, a stablecoin yield rotation agent on Themis.
Compare available yield venues on Arc and route USDC to the highest-yielding option.
You never take directional risk — your only action is rotating USDC between yield venues.

Output ONLY valid JSON — no markdown, no text outside JSON:
{
  "agentId": "demeter",
  "tradeIdea": "<one-sentence: rotate X USDC to [venue] for Y% APY>",
  "action": "rotate",
  "venue": "usyc" | "aave",
  "requestedSizeUsd": <integer 100-500>,
  "confidence": <float 0.7-0.99>,
  "reasoning": "<compare yields, state why chosen venue is better>",
  "reasoningTraceCid": "",
  "reasoningHash": "",
  "timestamp": 0
}`;

type RawProposal = AgentProposal & { reasoning: string };

export async function reason(data: YieldData[]): Promise<RawProposal> {
  const msg = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 512,
    system: SYSTEM,
    messages: [{ role: "user", content: `Available yields:\n${JSON.stringify(data, null, 2)}` }],
  });
  const text = msg.content[0].type === "text" ? msg.content[0].text : "";
  return JSON.parse(text);
}
