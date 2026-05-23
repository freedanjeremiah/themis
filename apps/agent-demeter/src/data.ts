import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

export type YieldData = {
  venue: "usyc" | "aave";
  apyBps: number;
  tvlUsdc: number;
};

export async function fetchYieldRates(): Promise<YieldData[]> {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.ARC_RPC_URL!);
    const blockNumber = await provider.getBlockNumber();
    // Realistic testnet mock values — vary per block for demo realism
    const base = blockNumber % 100;
    return [
      { venue: "usyc", apyBps: 520 + base, tvlUsdc: 1_000_000 },
      { venue: "aave", apyBps: 480 + Math.floor(base / 2), tvlUsdc: 5_000_000 },
    ];
  } catch {
    return [
      { venue: "usyc", apyBps: 520, tvlUsdc: 1_000_000 },
      { venue: "aave", apyBps: 480, tvlUsdc: 5_000_000 },
    ];
  }
}
