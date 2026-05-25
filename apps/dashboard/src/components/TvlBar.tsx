"use client";

type Props = { tvlUsdc: number; depositCount: number };

export function TvlBar({ tvlUsdc, depositCount }: Props) {
  return (
    <div className="flex items-center justify-between p-4 bg-gray-900 rounded-lg border border-gray-700">
      <div>
        <p className="text-xs text-gray-400 uppercase tracking-wider">Total Value Locked</p>
        <p className="text-4xl font-bold text-green-400 font-mono">
          ${(tvlUsdc / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </p>
        <p className="text-xs text-gray-500 mt-1">
          {depositCount} depositor{depositCount !== 1 ? "s" : ""}
        </p>
      </div>
      <div className="text-xs text-yellow-400 border border-yellow-600 rounded px-3 py-2 max-w-xs text-center">
        Hackathon prototype · Unaudited · Deposits capped at $100
      </div>
    </div>
  );
}
