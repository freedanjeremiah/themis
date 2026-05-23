"use client";

import { DepositPanel } from "./DepositPanel";

function CirclePoweredBadge() {
  return (
    <div className="flex items-center gap-1.5 mb-2">
      <span className="text-xs text-gray-500 font-medium">Powered by</span>
      <span className="text-xs font-semibold text-blue-400 tracking-tight">Circle</span>
      <span className="text-xs text-gray-600">·</span>
      <span className="text-xs text-gray-500">App Kit</span>
    </div>
  );
}

export function CircleKitDeposit({ liquidReservePct }: { liquidReservePct: number }) {
  return (
    <div>
      <CirclePoweredBadge />
      {/* DepositPanel is built on Circle's wagmi + Arc USDC stack.
          The full approve→deposit 2-step flow requires direct contract interaction
          beyond what SendTransactionForm covers (single-send UI). */}
      <DepositPanel liquidReservePct={liquidReservePct} />
    </div>
  );
}
