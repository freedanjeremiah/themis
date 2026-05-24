/**
 * Hyperliquid perp order placement helper.
 *
 * Uses HL's exchange API with the EIP-712 "phantom agent" signing pattern.
 * Returns { orderId, fillPrice, coin, sizeInCoins, szDecimals, isBuy } — never throws on HL
 * API errors (non-fatal since the CCTP bridge already completed).
 */
import { ethers } from "ethers";
import { pack } from "msgpackr";
import { AgentProposal } from "@themis/shared";

const HL_INFO_URL     = process.env.HYPERLIQUID_INFO_URL ?? "https://api.hyperliquid-testnet.xyz/info";
const HL_EXCHANGE_URL = process.env.HYPERLIQUID_EXCHANGE_URL ?? "https://api.hyperliquid-testnet.xyz/exchange";

interface HlMeta {
  universe: Array<{ name: string; szDecimals: number }>;
}

/**
 * Parse coin name from tradeIdea, e.g. "long ETH-PERP 5x" → "ETH".
 * Falls back to "ETH" if nothing is found.
 */
function parseCoin(tradeIdea: string): string {
  const match = tradeIdea.match(/([A-Z]+)-PERP/i);
  return match ? match[1].toUpperCase() : "ETH";
}

export async function placeHlOrder(
  privateKey: string,
  proposal: AgentProposal,
  allocatedUsd: number,
  agentName: string
): Promise<{
  orderId: number | null;
  fillPrice: number | null;
  coin: string;
  sizeInCoins: number;
  szDecimals: number;
  isBuy: boolean;
}> {
  const tag = `[${agentName}][hl]`;
  const coin = parseCoin(proposal.tradeIdea);
  const isBuy = proposal.action === "long";

  try {
    // Step 1 — Get asset metadata
    const metaResp = await fetch(HL_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meta" }),
    });
    if (!metaResp.ok) {
      console.warn(`${tag} meta request failed: ${metaResp.status}`);
      return { orderId: null, fillPrice: null, coin, sizeInCoins: 0, szDecimals: 0, isBuy };
    }
    const meta = (await metaResp.json()) as HlMeta;

    const assetIndex = meta.universe.findIndex((u) => u.name === coin);
    if (assetIndex === -1) {
      console.warn(`${tag} coin "${coin}" not found in HL universe`);
      return { orderId: null, fillPrice: null, coin, sizeInCoins: 0, szDecimals: 0, isBuy };
    }
    const szDecimals = meta.universe[assetIndex].szDecimals;

    // Step 2 — Get mark price
    const midsResp = await fetch(HL_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    });
    if (!midsResp.ok) {
      console.warn(`${tag} allMids request failed: ${midsResp.status}`);
      return { orderId: null, fillPrice: null, coin, sizeInCoins: 0, szDecimals: 0, isBuy };
    }
    const mids = (await midsResp.json()) as Record<string, string>;
    const markPriceStr = mids[coin];
    if (!markPriceStr) {
      console.warn(`${tag} no mark price found for "${coin}"`);
      return { orderId: null, fillPrice: null, coin, sizeInCoins: 0, szDecimals: 0, isBuy };
    }
    const markPrice = parseFloat(markPriceStr);

    // Step 3 — Compute limit price (5% slippage) and size
    const limitPrice = isBuy ? markPrice * 1.05 : markPrice * 0.95;
    const sizeInCoins = allocatedUsd / markPrice;

    const limitPriceStr = limitPrice.toFixed(1);
    const sizeStr       = sizeInCoins.toFixed(szDecimals);

    console.log(
      `${tag} placing ${isBuy ? "BUY" : "SELL"} ${coin} ` +
      `size=${sizeStr} limitPrice=${limitPriceStr} (mark=${markPrice})`
    );

    // Step 4 — Build action
    const action = {
      type: "order",
      orders: [
        {
          a: assetIndex,
          b: isBuy,
          p: limitPriceStr,
          s: sizeStr,
          r: false,
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
    };

    const nonce = Date.now();

    // Step 5 — Sign with EIP-712 phantom agent pattern
    const actionBytes = pack(action);
    const nonceBuf    = Buffer.alloc(8);
    nonceBuf.writeBigUInt64BE(BigInt(nonce));
    const combined   = Buffer.concat([actionBytes, nonceBuf]);
    const actionHash = ethers.keccak256(combined);

    const domain = {
      name: "Exchange",
      version: "1",
      chainId: 1337,
      verifyingContract: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    };
    const types = {
      Agent: [
        { name: "source",       type: "string"  },
        { name: "connectionId", type: "bytes32" },
      ],
    };
    const phantomAgent = {
      source:       "a",
      connectionId: actionHash,
    };

    const wallet = new ethers.Wallet(privateKey);
    const sig    = await wallet.signTypedData(domain, types, phantomAgent);
    const { r, s, v } = ethers.Signature.from(sig);

    // Step 6 — Submit to exchange
    const body = {
      action,
      nonce,
      signature: { r, s, v },
      vaultAddress: null,
    };

    const exchResp = await fetch(HL_EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!exchResp.ok) {
      console.warn(`${tag} exchange request failed: ${exchResp.status}`);
      return { orderId: null, fillPrice: null, coin, sizeInCoins, szDecimals, isBuy };
    }
    const result = (await exchResp.json()) as unknown;

    // Step 7 — Extract fill info
    const status    = (result as any)?.response?.data?.statuses?.[0];
    const fillPrice = status?.filled?.avgPx ? parseFloat(status.filled.avgPx) : null;
    const orderId   = status?.resting?.oid ?? null;

    if (fillPrice !== null) {
      console.log(`${tag} order filled at avg price ${fillPrice}`);
      return { orderId, fillPrice, coin, sizeInCoins, szDecimals, isBuy };
    } else if (orderId !== null) {
      console.log(`${tag} order resting on book (oid: ${orderId})`);
    } else {
      console.warn(`${tag} order unfilled/rejected (status=${JSON.stringify(status)}); using mark price simulated fill`);
    }

    // Fall back to simulated fill at mark price (paper-trade mode — no HL L1 margin).
    console.log(`${tag} SIMULATED fill at mark price ${markPrice}`);
    return { orderId: null, fillPrice: markPrice, coin, sizeInCoins, szDecimals, isBuy };
  } catch (err) {
    console.warn(`${tag} order placement error (non-fatal):`, err);
    return { orderId: null, fillPrice: null, coin, sizeInCoins: 0, szDecimals: 0, isBuy };
  }
}

/**
 * Close an open HL perp position by placing a reverse IOC market order.
 * Returns { exitPrice } or null on failure.
 */
export async function closeHlPosition(
  privateKey: string,
  coin: string,
  sizeInCoins: number,
  szDecimals: number,
  wasLong: boolean,
  agentName: string
): Promise<{ exitPrice: number } | null> {
  const tag = `[${agentName}][hl]`;
  const isBuy = !wasLong; // close reverses direction

  try {
    // Step 1 — Get asset metadata
    const metaResp = await fetch(HL_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "meta" }),
    });
    if (!metaResp.ok) {
      console.warn(`${tag} closeHlPosition: meta request failed: ${metaResp.status}`);
      return null;
    }
    const meta = (await metaResp.json()) as HlMeta;

    const assetIndex = meta.universe.findIndex((u) => u.name === coin);
    if (assetIndex === -1) {
      console.warn(`${tag} closeHlPosition: coin "${coin}" not found in HL universe`);
      return null;
    }

    // Step 2 — Get fresh mark price for close order limit
    const midsResp = await fetch(HL_INFO_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "allMids" }),
    });
    if (!midsResp.ok) {
      console.warn(`${tag} closeHlPosition: allMids request failed: ${midsResp.status}`);
      return null;
    }
    const mids = (await midsResp.json()) as Record<string, string>;
    const markPriceStr = mids[coin];
    if (!markPriceStr) {
      console.warn(`${tag} closeHlPosition: no mark price found for "${coin}"`);
      return null;
    }
    const markPrice = parseFloat(markPriceStr);

    // 5% slippage on close (same as open)
    const limitPrice = isBuy ? markPrice * 1.05 : markPrice * 0.95;
    const limitPriceStr = limitPrice.toFixed(1);
    const sizeStr = sizeInCoins.toFixed(szDecimals);

    console.log(
      `${tag} closing position: ${isBuy ? "BUY" : "SELL"} ${coin} ` +
      `size=${sizeStr} limitPrice=${limitPriceStr} (mark=${markPrice}) reduceOnly=true`
    );

    // Build action with r: true (reduceOnly)
    const action = {
      type: "order",
      orders: [
        {
          a: assetIndex,
          b: isBuy,
          p: limitPriceStr,
          s: sizeStr,
          r: true,
          t: { limit: { tif: "Ioc" } },
        },
      ],
      grouping: "na",
    };

    const nonce = Date.now();

    // Sign with EIP-712 phantom agent pattern
    const actionBytes = pack(action);
    const nonceBuf    = Buffer.alloc(8);
    nonceBuf.writeBigUInt64BE(BigInt(nonce));
    const combined   = Buffer.concat([actionBytes, nonceBuf]);
    const actionHash = ethers.keccak256(combined);

    const domain = {
      name: "Exchange",
      version: "1",
      chainId: 1337,
      verifyingContract: "0x0000000000000000000000000000000000000000" as `0x${string}`,
    };
    const types = {
      Agent: [
        { name: "source",       type: "string"  },
        { name: "connectionId", type: "bytes32" },
      ],
    };
    const phantomAgent = {
      source:       "a",
      connectionId: actionHash,
    };

    const wallet = new ethers.Wallet(privateKey);
    const sig    = await wallet.signTypedData(domain, types, phantomAgent);
    const { r, s, v } = ethers.Signature.from(sig);

    const body = {
      action,
      nonce,
      signature: { r, s, v },
      vaultAddress: null,
    };

    const exchResp = await fetch(HL_EXCHANGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!exchResp.ok) {
      console.warn(`${tag} closeHlPosition: exchange request failed: ${exchResp.status}`);
      return null;
    }
    const result = (await exchResp.json()) as unknown;

    const status    = (result as any)?.response?.data?.statuses?.[0];
    const fillPrice = status?.filled?.avgPx ? parseFloat(status.filled.avgPx) : null;

    if (fillPrice !== null) {
      console.log(`${tag} close order filled at avg price ${fillPrice}`);
      return { exitPrice: fillPrice };
    }

    // Close order didn't fill (no real position on HL L1) — use mark price as simulated exit.
    console.warn(`${tag} close order unfilled (status=${JSON.stringify(status)}); using mark price ${markPrice}`);
    console.log(`${tag} SIMULATED close at mark price ${markPrice}`);
    return { exitPrice: markPrice };
  } catch (err) {
    console.warn(`${tag} closeHlPosition error (non-fatal):`, err);
    return null;
  }
}
