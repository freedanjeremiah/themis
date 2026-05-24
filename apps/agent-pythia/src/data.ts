import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });
import { ethers } from "ethers";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { payForDataCall } from "./gateway.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, "../.headline-cache.json");
const CACHE_TTL_MS = 30 * 60_000; // 30 min

// Create a Pythia wallet for signing nanopayments
const pythiaWallet = process.env.PRIVATE_KEY_PYTHIA
  ? new ethers.Wallet(process.env.PRIVATE_KEY_PYTHIA)
  : null;

export type NewsItem = { title: string; source: string; publishedAt: string };

function readCache(): { items: NewsItem[]; ts: number } | null {
  if (!existsSync(CACHE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf8")) as { items: NewsItem[]; ts: number };
  } catch { return null; }
}

function writeCache(items: NewsItem[]): void {
  try {
    writeFileSync(CACHE_PATH, JSON.stringify({ items, ts: Date.now() }));
  } catch (err) {
    console.warn(`[pythia] headline cache write failed:`, err);
  }
}

export class StaleHeadlinesError extends Error {
  constructor() { super("All data sources failed and cache is stale (>30min)"); }
}

export async function fetchNewsHeadlines(): Promise<NewsItem[]> {
  try {
    const paymentHeader = pythiaWallet ? await payForDataCall(pythiaWallet, "twitter.com/crypto-headlines") : null;
    const resp = await axios.get(
      "https://api.twitter.com/2/tweets/search/recent?query=bitcoin+OR+ethereum+crypto+lang:en&max_results=10&tweet.fields=created_at",
      {
        headers: {
          Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}`,
          ...(paymentHeader ? { "X-Payment": paymentHeader } : {}),
        },
      }
    );
    const items: NewsItem[] = (resp.data.data ?? []).map((t: any) => ({
      title: t.text,
      source: "twitter",
      publishedAt: t.created_at,
    }));
    if (items.length > 0) { writeCache(items); return items; }
  } catch { /* fall through */ }

  try {
    const rssPaymentHeader = pythiaWallet ? await payForDataCall(pythiaWallet, "coindesk.com/rss", 500) : null;
    const rss = await axios.get("https://www.coindesk.com/arc/outboundfeeds/rss/", {
      headers: {
        "User-Agent": "Themis/1.0",
        ...(rssPaymentHeader ? { "X-Payment": rssPaymentHeader } : {}),
      },
    });
    const matches = [...rss.data.matchAll(/<title><!\[CDATA\[(.+?)\]\]><\/title>/g)];
    const items: NewsItem[] = matches.slice(0, 10).map((m: RegExpMatchArray) => ({
      title: m[1],
      source: "coindesk",
      publishedAt: new Date().toISOString(),
    }));
    if (items.length > 0) { writeCache(items); return items; }
  } catch { /* fall through */ }

  const cached = readCache();
  if (cached && (Date.now() - cached.ts) < CACHE_TTL_MS) {
    console.warn(`[pythia] live data sources failed; using cache (age ${Math.round((Date.now() - cached.ts) / 1000)}s)`);
    return cached.items;
  }

  throw new StaleHeadlinesError();
}
