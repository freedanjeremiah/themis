/**
 * Execute a Pythia trade: place a perp order on HL testnet (uses @themis/hl-client).
 * HL wallet is pre-funded with testnet USDC — no Arc→HL bridge needed.
 *
 * Gated by ENABLE_REAL_TRADES=true. The cycle in index.ts handles stuck
 * reporting and settle.
 */
import { AgentProposal } from "@themis/shared";
import { placeHlOrder } from "@themis/hl-client";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const ENABLE_REAL_TRADES = process.env.ENABLE_REAL_TRADES === "true";

export type PythiaPosition = {
  fillPrice: number;
  coin: string;
  sizeInCoins: number;
  szDecimals: number;
  isBuy: boolean;
};

export type ExecuteResult =
  | { ok: true; position: PythiaPosition }
  | { ok: false; reason: string };

export async function executePythiaTrade(
  proposal: AgentProposal,
  allocatedUsd: number,
): Promise<ExecuteResult> {
  if (!ENABLE_REAL_TRADES) {
    console.log(`[pythia] CCTP bridge skipped (ENABLE_REAL_TRADES=false): would trade ${allocatedUsd} USDC for ${proposal.tradeIdea}`);
    return { ok: false, reason: "real_trades_disabled" };
  }

  console.log(`[pythia] using pre-funded HL testnet USDC for $${allocatedUsd} trade`);

  const order = await placeHlOrder(
    process.env.PRIVATE_KEY_PYTHIA!,
    proposal,
    allocatedUsd,
    "pythia",
  ).catch(err => {
    console.warn(`[pythia] HL order placement failed:`, err);
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
