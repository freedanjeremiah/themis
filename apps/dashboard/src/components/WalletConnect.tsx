"use client";
import { useAccount, useConnect, useDisconnect } from "wagmi";

export function WalletConnect() {
  const { address, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400 font-mono">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button
          onClick={() => disconnect()}
          className="text-xs text-gray-500 hover:text-red-400 transition-colors"
        >
          Disconnect
        </button>
      </div>
    );
  }

  const connector = connectors[0];

  return (
    <button
      onClick={() => connector && connect({ connector })}
      disabled={!connector}
      className={`px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded transition-colors ${!connector ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      Connect Wallet
    </button>
  );
}
