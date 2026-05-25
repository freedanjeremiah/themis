"use client";
import { useAccount, useConnect, useDisconnect } from "wagmi";

export function WalletConnect() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <span className="inline-flex items-baseline gap-2">
        <span className="text-xs tnum text-ink-2">{address.slice(0, 6)}…{address.slice(-4)}</span>
        <button
          onClick={() => disconnect()}
          className="press text-2xs font-semibold uppercase tracking-[0.1em] text-ink-3 hover:text-loss"
        >
          Disconnect
        </button>
      </span>
    );
  }

  const connector = connectors[0];

  return (
    <button
      onClick={() => connector && connect({ connector })}
      disabled={!connector}
      className="press border border-ink/30 px-3 py-1 text-2xs font-semibold uppercase tracking-[0.1em] text-ink hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
    >
      Connect wallet
    </button>
  );
}
