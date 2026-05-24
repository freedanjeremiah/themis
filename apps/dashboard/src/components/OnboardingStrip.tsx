"use client";
import { useConnect, useSwitchChain } from "wagmi";
import { injected } from "wagmi/connectors";
import { useOnboardingStep, type OnboardingStep } from "../hooks/useOnboardingStep.js";

const ARC_TESTNET_CHAIN_ID = 5042002;
const FAUCET_URL = process.env.NEXT_PUBLIC_FAUCET_URL ?? "https://docs.arc.network/testnet";

const STEPS: Array<{ id: OnboardingStep; label: string }> = [
  { id: 1, label: "Connect wallet" },
  { id: 2, label: "Add Arc testnet" },
  { id: 3, label: "Get testnet USDC" },
  { id: 4, label: "Deposit $10" },
];

export function OnboardingStrip({
  onDepositClick,
}: {
  onDepositClick: () => void;
}) {
  const { step, dismissed, dismiss, address } = useOnboardingStep();
  const { connect } = useConnect();
  const { switchChain } = useSwitchChain();

  if (dismissed || step >= 4) return null;

  const buttonForStep = () => {
    switch (step) {
      case 0:
        return (
          <button onClick={() => connect({ connector: injected() })}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded px-4 py-2 font-semibold">
            Connect wallet
          </button>
        );
      case 1:
        return (
          <button onClick={() => switchChain({ chainId: ARC_TESTNET_CHAIN_ID })}
            className="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded px-4 py-2 font-semibold">
            Add / switch to Arc testnet
          </button>
        );
      case 2:
        return (
          <div className="flex items-center gap-2">
            <a href={FAUCET_URL} target="_blank" rel="noreferrer"
              className="bg-blue-600 hover:bg-blue-500 text-white text-sm rounded px-4 py-2 font-semibold">
              Get testnet USDC ↗
            </a>
            {address && (
              <button
                onClick={() => navigator.clipboard.writeText(address).catch(() => {})}
                className="text-xs text-gray-400 hover:text-white border border-gray-600 rounded px-3 py-2 font-mono"
                title="Copy your address for the faucet">
                Copy {address.slice(0, 6)}…{address.slice(-4)}
              </button>
            )}
          </div>
        );
      case 3:
        return (
          <button onClick={onDepositClick}
            className="bg-green-600 hover:bg-green-500 text-white text-sm rounded px-4 py-2 font-semibold">
            Deposit $10 →
          </button>
        );
    }
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 text-sm">
        {STEPS.map((s, i) => (
          <span key={s.id} className="flex items-center gap-3">
            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold border
              ${s.id < step ? "bg-green-700 border-green-500 text-white"
                : s.id === step ? "bg-blue-700 border-blue-400 text-white"
                : "bg-gray-800 border-gray-600 text-gray-500"}`}>
              {s.id < step ? "✓" : s.id}
            </span>
            <span className={s.id <= step ? "text-white" : "text-gray-500"}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="text-gray-600">→</span>}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3">
        {buttonForStep()}
        <button onClick={dismiss}
          className="text-gray-500 hover:text-gray-300 text-lg" aria-label="Dismiss onboarding">
          ×
        </button>
      </div>
    </div>
  );
}
