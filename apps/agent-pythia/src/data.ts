import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

export type NewsItem = { title: string; source: string; publishedAt: string };

export async function fetchNewsHeadlines(): Promise<NewsItem[]> {
  try {
    const resp = await axios.get(
      "https://api.twitter.com/2/tweets/search/recent?query=bitcoin+OR+ethereum+crypto+lang:en&max_results=10&tweet.fields=created_at",
      { headers: { Authorization: `Bearer ${process.env.TWITTER_BEARER_TOKEN}` } }
    );
    return (resp.data.data ?? []).map((t: any) => ({
      title: t.text,
      source: "twitter",
      publishedAt: t.created_at,
    }));
  } catch {
    // Fallback: CoinDesk RSS
    try {
      const rss = await axios.get("https://www.coindesk.com/arc/outboundfeeds/rss/", {
        headers: { "User-Agent": "Themis/1.0" }
      });
      const matches = [...rss.data.matchAll(/<title><!\[CDATA\[(.+?)\]\]><\/title>/g)];
      return matches.slice(0, 10).map((m: RegExpMatchArray) => ({
        title: m[1],
        source: "coindesk",
        publishedAt: new Date().toISOString(),
      }));
    } catch {
      // Last resort: return a generic neutral headline
      return [{ title: "Crypto markets steady, no major moves", source: "fallback", publishedAt: new Date().toISOString() }];
    }
  }
}
