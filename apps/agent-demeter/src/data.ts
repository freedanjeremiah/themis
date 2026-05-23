import { ethers } from "ethers";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

export type YieldData = {
  venue: "usyc" | "aave";
  apyBps: number;
  tvlUsdc: number;
};

// ERC-4626 minimal ABI for USYC share price
const ERC4626_ABI = [
  "function convertToAssets(uint256 shares) view returns (uint256)",
  "function totalAssets() view returns (uint256)",
];

// Aave v3 IPool getReserveData — only the fields we need
// Returns tuple; currentLiquidityRate is at index 2 (RAY = 1e27 per second)
const AAVE_POOL_ABI = [
  "function getReserveData(address asset) view returns (uint256 configuration, uint128 liquidityIndex, uint128 currentLiquidityRate, uint128 variableBorrowIndex, uint128 currentVariableBorrowRate, uint128 currentStableBorrowRate, uint40 lastUpdateTimestamp, uint16 id, address aTokenAddress, address stableDebtTokenAddress, address variableDebtTokenAddress, address interestRateStrategyAddress, uint128 accruedToTreasury, uint128 unbacked, uint128 isolationModeTotalDebt)",
];

// Module-level cache for USYC share price (used to estimate APY across cycles)
let usycCache: { assets: bigint; blockTime: number } | null = null;
const RAY = BigInt("1000000000000000000000000000"); // 1e27
const SECONDS_PER_YEAR = 31_536_000n;
const BPS = 10_000n;

async function fetchUsycApy(provider: ethers.Provider, usycAddress: string): Promise<number> {
  const contract = new ethers.Contract(usycAddress, ERC4626_ABI, provider);
  const ONE_USDC = BigInt(1_000_000); // 1 USDC in 6-decimal units
  const assets: bigint = await contract.convertToAssets(ONE_USDC);
  const now = Math.floor(Date.now() / 1000);

  if (usycCache === null) {
    usycCache = { assets, blockTime: now };
    return 520; // bootstrap — return last known USYC yield (≈5.2%)
  }

  const elapsed = now - usycCache.blockTime;
  if (elapsed < 30) return 520; // too soon between readings

  const gain = assets - usycCache.assets;
  if (gain <= 0n) {
    usycCache = { assets, blockTime: now };
    return 520;
  }

  // Annualized APY in BPS = (gain / prev) / elapsed * seconds_per_year * 10000
  const apyBps = Number((gain * BigInt(SECONDS_PER_YEAR) * BPS) / (usycCache.assets * BigInt(elapsed)));
  usycCache = { assets, blockTime: now };
  return Math.max(0, Math.min(2000, apyBps)); // clamp 0–20%
}

async function fetchAaveApy(provider: ethers.Provider, poolAddress: string, usdcAddress: string): Promise<number> {
  const contract = new ethers.Contract(poolAddress, AAVE_POOL_ABI, provider);
  const data = await contract.getReserveData(usdcAddress);
  // currentLiquidityRate is index 2, in RAY (1e27) per second
  const liquidityRate: bigint = data[2];
  // APY ≈ liquidityRate / RAY * seconds_per_year * BPS (linear approximation)
  const apyBps = Number((liquidityRate * SECONDS_PER_YEAR * BPS) / RAY);
  return Math.max(0, Math.min(2000, apyBps));
}

export async function fetchYieldRates(): Promise<YieldData[]> {
  const arcRpc = process.env.ARC_RPC_URL;
  const usycAddress = process.env.USYC_ADDRESS;
  const aaveAddress = process.env.AAVE_POOL_ADDRESS;
  const usdcAddress = process.env.USDC_ADDRESS ?? "0x3600000000000000000000000000000000000000";

  const hasTbd = (v?: string) => !v || v.includes("<") || v === "0x...";

  // If addresses aren't deployed yet, return mock values
  if (hasTbd(usycAddress) && hasTbd(aaveAddress)) {
    try {
      const provider = new ethers.JsonRpcProvider(arcRpc!);
      const blockNumber = await provider.getBlockNumber();
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

  const provider = new ethers.JsonRpcProvider(arcRpc!);
  const results: YieldData[] = [];

  // USYC
  if (!hasTbd(usycAddress)) {
    try {
      const apyBps = await fetchUsycApy(provider, usycAddress!);
      results.push({ venue: "usyc", apyBps, tvlUsdc: 1_000_000 });
    } catch (err) {
      console.warn("[demeter] USYC yield read failed, using mock:", err);
      results.push({ venue: "usyc", apyBps: 520, tvlUsdc: 1_000_000 });
    }
  } else {
    results.push({ venue: "usyc", apyBps: 520, tvlUsdc: 1_000_000 });
  }

  // Aave
  if (!hasTbd(aaveAddress)) {
    try {
      const apyBps = await fetchAaveApy(provider, aaveAddress!, usdcAddress);
      results.push({ venue: "aave", apyBps, tvlUsdc: 5_000_000 });
    } catch (err) {
      console.warn("[demeter] Aave yield read failed, using mock:", err);
      results.push({ venue: "aave", apyBps: 480, tvlUsdc: 5_000_000 });
    }
  } else {
    results.push({ venue: "aave", apyBps: 480, tvlUsdc: 5_000_000 });
  }

  return results;
}
