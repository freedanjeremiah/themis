/**
 * Execute a Hermes trade:
 *   1. Bridge USDC from Arc → HL testnet via CCTP (uses cctp.ts).
 *   2. Place perp order on HL testnet (uses @themis/hl-client).
 *
 * Gated by ENABLE_REAL_TRADES=true. Returns null when bridge or order fails,
 * or when ENABLE_REAL_TRADES is false. The cycle in index.ts handles stuck
 * reporting and settle.
 */
import { AgentProposal } from "@themis/shared";
import { placeHlOrder } from "@themis/hl-client";
import { bridgeArcToHl } from "./cctp.js";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const ENABLE_REAL_TRADES = process.env.ENABLE_REAL_TRADES === "true";

export type HermesPosition = {
  fillPrice: number;
  coin: string;
  sizeInCoins: number;
  szDecimals: number;
  isBuy: boolean;
};

export type ExecuteResult =
  | { ok: true; position: HermesPosition }
  | { ok: false; reason: string; burnTxHash?: string };

export async function executeHermesTrade(
  proposal: AgentProposal,
  allocatedUsd: number,
): Promise<ExecuteResult> {
  if (!ENABLE_REAL_TRADES) {
    console.log(`[hermes] CCTP bridge skipped (ENABLE_REAL_TRADES=false): would trade ${allocatedUsd} USDC for ${proposal.tradeIdea}`);
    return { ok: false, reason: "real_trades_disabled" };
  }

  const amountUsdc6 = BigInt(Math.floor(allocatedUsd * 1_000_000));
  const bridge = await bridgeArcToHl(amountUsdc6);
  if (bridge.status !== "complete") {
    return { ok: false, reason: bridge.status, burnTxHash: bridge.burnTxHash };
  }

  const order = await placeHlOrder(
    process.env.PRIVATE_KEY_HERMES!,
    proposal,
    allocatedUsd,
    "hermes",
  ).catch(err => {
    console.warn(`[hermes] HL order placement failed:`, err);
    return null;
  });

  if (!order || order.fillPrice === null) {
    return { ok: false, reason: "hl_order_unfilled" };
  }

  return {
    ok: true,
    position: {
      fillPrice: order.fillPrice,
      coin: order.coin,
      sizeInCoins: order.sizeInCoins,
      szDecimals: order.szDecimals,
      isBuy: order.isBuy,
    },
  };
}
