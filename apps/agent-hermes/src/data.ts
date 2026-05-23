import axios from "axios";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

export type FundingEntry = { market: string; fundingRate: number; openInterest: number };

export async function fetchFundingRates(): Promise<FundingEntry[]> {
  const resp = await axios.post(process.env.HYPERLIQUID_API_URL!, {
    type: "metaAndAssetCtxs",
  });
  const [meta, ctxs] = resp.data as [
    { universe: { name: string }[] },
    { funding: string; openInterest: string }[]
  ];
  return meta.universe.map((asset, i) => ({
    market: asset.name,
    fundingRate: parseFloat(ctxs[i].funding),
    openInterest: parseFloat(ctxs[i].openInterest),
  }));
}
