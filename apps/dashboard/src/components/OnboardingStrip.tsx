"use client";
import { useConnect } from "wagmi";
import { injected } from "wagmi/connectors";
import { useOnboardingStep, type OnboardingStep } from "../hooks/useOnboardingStep";

const ARC_CHAIN_PARAMS = {
  chainId: "0x4CEF52" as const, // 5042002 in hex
  chainName: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 6 },
  rpcUrls: ["https://rpc.testnet.arc.network"],
  blockExplorerUrls: [] as string[],
};
const FAUCET_URL = process.env.NEXT_PUBLIC_FAUCET_URL ?? "https://docs.arc.network/testnet";

async function addAndSwitchToArc() {
  const provider = (window as any).ethereum;
  if (!provider) return;
  try {
    await provider.request({ method: "wallet_addEthereumChain", params: [ARC_CHAIN_PARAMS] });
  } catch {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_PARAMS.chainId }] });
  }
}

const STEPS: Array<{ id: OnboardingStep; label: string }> = [
  { id: 1, label: "Connect" },
  { id: 2, label: "Add Arc" },
  { id: 3, label: "Get USDC" },
  { id: 4, label: "Deposit" },
];

const CTA = "press bg-accent px-4 py-1.5 text-2xs font-semibold uppercase tracking-[0.12em] text-paper hover:opacity-90";

export function OnboardingStrip({ onDepositClick }: { onDepositClick: () => void }) {
  const { step, dismissed, dismiss, address } = useOnboardingStep();
  const { connect } = useConnect();

  if (dismissed || step >= 4) return null;

  const buttonForStep = () => {
    switch (step) {
      case 0:
        return <button onClick={() => connect({ connector: injected() })} className={CTA}>Connect wallet</button>;
      case 1:
        return <button onClick={addAndSwitchToArc} className={CTA}>Add / switch to Arc</button>;
      case 2:
        return (
          <div className="flex items-center gap-3">
            <a href={FAUCET_URL} target="_blank" rel="noreferrer" className={CTA}>Get testnet USDC</a>
            {address && (
              <button
                onClick={() => navigator.clipboard.writeText(address).catch(() => {})}
                className="press text-2xs font-semibold uppercase tracking-[0.1em] text-ink-3 hover:text-accent"
                title="Copy your address for the faucet"
              >
                Copy {address.slice(0, 6)}…{address.slice(-4)}
              </button>
            )}
          </div>
        );
      case 3:
        return <button onClick={onDepositClick} className={CTA}>Deposit $10</button>;
    }
  };

  return (
    <div className="flex flex-col gap-3 border-y border-ink/15 py-3 md:flex-row md:items-center md:justify-between">
      <div className="flex items-center gap-3 overflow-x-auto">
        <span className="label shrink-0">To subscribe</span>
        {STEPS.map((s, i) => {
          const done = s.id <= step;
          const active = s.id === step + 1;
          return (
            <span key={s.id} className="flex items-center gap-2 whitespace-nowrap">
              <span className={`font-serif text-sm tnum ${done ? "text-accent" : active ? "text-ink" : "text-ink-3"}`}>
                {done ? "✓" : `${s.id}.`}
              </span>
              <span className={`text-xs ${done ? "text-ink-2 line-through decoration-ink/30" : active ? "font-medium text-ink" : "text-ink-3"}`}>
                {s.label}
              </span>
              {i < STEPS.length - 1 && <span className="text-ink/25">·</span>}
            </span>
          );
        })}
      </div>
      <div className="flex items-center gap-3">
        {buttonForStep()}
        <button onClick={dismiss} className="press text-base text-ink-3 hover:text-ink" aria-label="Dismiss">×</button>
      </div>
    </div>
  );
}
