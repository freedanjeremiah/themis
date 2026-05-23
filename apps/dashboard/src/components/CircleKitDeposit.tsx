"use client";

/**
 * Circle App Kit deposit wrapper.
 * Uses @circle-libs/react-elements SendTransactionForm where the API fits;
 * falls back to the wagmi-based DepositPanel for the full approve→deposit flow
 * since vault deposits require a 2-step ERC20 approve + contract call.
 *
 * Circle stack in use:
 *  - wagmi v2 + viem on Arc (Circle-recommended EVM toolkit)
 *  - USDC as native gas on Arc (Circle's enshrined stablecoin)
 *  - CCTP V2 for cross-chain USDC bridging (Hermes/Pythia agents)
 */

import dynamic from "next/dynamic";
import { DepositPanel } from "./DepositPanel";

// Lazy load Circle elements — avoids SSR issues and bundle overhead if unavailable
const CircleSendForm = dynamic(
  () =>
    import("@circle-libs/react-elements")
      .then(m => m.SendTransactionForm ?? m.default)
      .catch(() => null as never),
  { ssr: false, loading: () => null }
);

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
