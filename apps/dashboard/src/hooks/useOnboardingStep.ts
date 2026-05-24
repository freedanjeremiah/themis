"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useChainId, useReadContract } from "wagmi";
import ThemisVaultABIRaw from "@themis/shared/abis/ThemisVault.json";

const ThemisVaultABI = ThemisVaultABIRaw as readonly any[];
const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }] },
] as const;

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;
const VAULT_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "") as `0x${string}`;
const ARC_TESTNET_CHAIN_ID = 5042002;
const MIN_USDC_USD = 10;  // step 2 considers wallet "funded" at $10+
const DISMISS_KEY = "themis_onboarding_dismissed_v1";

export type OnboardingStep = 0 | 1 | 2 | 3 | 4;

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
}
function writeDismissed(): void {
  try { window.localStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
}

export function useOnboardingStep() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();

  const usdcBalance = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && chainId === ARC_TESTNET_CHAIN_ID, refetchInterval: 10_000 },
  });

  const deposited = useReadContract({
    address: VAULT_ADDRESS,
    abi: ThemisVaultABI,
    functionName: "depositedBy",
    args: address ? [address] : undefined,
    query: { enabled: !!address && chainId === ARC_TESTNET_CHAIN_ID && !!VAULT_ADDRESS, refetchInterval: 10_000 },
  });

  const [dismissed, setDismissed] = useState(false);
  useEffect(() => { setDismissed(readDismissed()); }, []);

  // Debounce raw step to suppress 1→2→3 flashes when wagmi state lands in rapid succession.
  const rawStep: OnboardingStep = useMemo(() => {
    if (!isConnected || !address) return 0;
    if (chainId !== ARC_TESTNET_CHAIN_ID) return 1;
    const usdcRaw = (usdcBalance.data as bigint | undefined) ?? 0n;
    const usdcUsd = Number(usdcRaw) / 1_000_000;
    if (usdcUsd < MIN_USDC_USD) return 2;
    const depRaw = (deposited.data as bigint | undefined) ?? 0n;
    if (depRaw === 0n) return 3;
    return 4;
  }, [isConnected, address, chainId, usdcBalance.data, deposited.data]);

  const [step, setStep] = useState<OnboardingStep>(rawStep);
  useEffect(() => {
    const t = setTimeout(() => setStep(rawStep), 250);
    return () => clearTimeout(t);
  }, [rawStep]);

  const dismiss = () => { setDismissed(true); writeDismissed(); };

  return {
    step,
    dismissed,
    dismiss,
    address,
    chainId,
    usdcBalanceUsd: (usdcBalance.data as bigint | undefined) ? Number(usdcBalance.data) / 1_000_000 : 0,
  };
}
