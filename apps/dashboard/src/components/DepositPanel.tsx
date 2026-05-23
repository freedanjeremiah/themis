"use client";
import { useState } from "react";

export function DepositPanel({ liquidReservePct }: { liquidReservePct: number }) {
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");

  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
        {tab === "deposit" ? "Deposit" : "Withdraw"}
      </h2>
      <div className="flex gap-2 mb-4">
        {(["deposit", "withdraw"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 rounded text-sm font-medium transition-colors ${
              tab === t
                ? "bg-blue-600 text-white"
                : "text-gray-400 hover:text-white bg-gray-800"
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Circle App Kit Send component placeholder */}
      <div className="text-center text-gray-500 text-sm py-6 border border-dashed border-gray-700 rounded">
        {tab === "deposit"
          ? "Circle App Kit · Deposit USDC (max $100)"
          : "Circle App Kit · Burn shares for USDC"}
      </div>

      <p className="text-xs text-gray-500 mt-3">
        Liquid reserve:{" "}
        <span className={liquidReservePct < 25 ? "text-yellow-400" : "text-gray-400"}>
          {liquidReservePct.toFixed(1)}%
        </span>
        {liquidReservePct < 25 && (
          <span className="block text-yellow-500 mt-1">
            Reserve low — large withdrawals may revert
          </span>
        )}
      </p>
    </div>
  );
}
