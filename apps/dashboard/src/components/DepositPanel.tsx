"use client";
import { useEffect, useState } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { parseUnits, formatUnits } from "viem";
import { Loader2, ShieldAlert } from "lucide-react";
import ThemisVaultABIRaw from "@themis/shared/abis/ThemisVault.json";
import { wagmiConfig } from "../lib/wagmi";
import { WalletConnect } from "./WalletConnect";

const ThemisVaultABI = ThemisVaultABIRaw as readonly any[];

const ERC20_ABI = [
  { name: "approve", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }] },
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }] },
] as const;

const VAULT_READ_ABI = [
  { name: "shareBalances", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "sharePrice", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { name: "totalShares", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
  { name: "totalAssets", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint256" }] },
] as const;

const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

const VAULT_ADDRESS = (process.env.NEXT_PUBLIC_VAULT_ADDRESS ?? "") as `0x${string}`;
const vaultConfigured =
  (VAULT_ADDRESS as string) !== "" &&
  (VAULT_ADDRESS as string) !== "0x0000000000000000000000000000000000000000";
const WALLET_CAP_USDC = 100; // $100

export function DepositPanel({
  liquidReservePct,
  prefilledAmount,
  prefillNonce,
}: {
  liquidReservePct: number;
  prefilledAmount?: number;
  prefillNonce?: number;
}) {
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [withdrawMode, setWithdrawMode] = useState<"usdc" | "shares">("usdc");
  const [amount, setAmount] = useState("");
  useEffect(() => {
    if (typeof prefilledAmount === "number" && prefilledAmount > 0) {
      setAmount(String(prefilledAmount));
    }
  }, [prefilledAmount, prefillNonce]);
  const [step, setStep] = useState<"idle" | "approving" | "depositing" | "withdrawing">("idle");
  const [error, setError] = useState<string | null>(null);
  const { address, isConnected } = useAccount();

  const { data: depositedRaw } = useReadContract({
    address: VAULT_ADDRESS,
    abi: ThemisVaultABI,
    functionName: "depositedBy",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address },
  });

  const { data: usdcBalanceRaw } = useReadContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address },
  });

  const { data: shareBalanceRaw } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_READ_ABI,
    functionName: "shareBalances",
    args: [address ?? "0x0000000000000000000000000000000000000000"],
    query: { enabled: !!address },
  });

  const { data: sharePriceRaw } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_READ_ABI,
    functionName: "sharePrice",
    query: { enabled: !!address },
  });

  const { data: totalSharesRaw } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_READ_ABI,
    functionName: "totalShares",
    query: { enabled: !!address },
  });

  const { data: totalAssetsRaw } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_READ_ABI,
    functionName: "totalAssets",
    query: { enabled: !!address },
  });

  const deposited = depositedRaw ? Number(formatUnits(depositedRaw as bigint, 6)) : 0;
  const usdcBalance = usdcBalanceRaw ? Number(formatUnits(usdcBalanceRaw as bigint, 6)) : 0;
  const remaining = Math.max(0, WALLET_CAP_USDC - deposited);

  const shareBalance = shareBalanceRaw ? (shareBalanceRaw as bigint) : 0n;
  const sharePriceBig = sharePriceRaw ? (sharePriceRaw as bigint) : 1_000_000n;
  const totalSharesBig = totalSharesRaw ? (totalSharesRaw as bigint) : 0n;
  const totalAssetsBig = totalAssetsRaw ? (totalAssetsRaw as bigint) : 0n;
  // withdrawable USDC = shares * sharePrice / 1e6
  const withdrawableUsdc = Number(shareBalance) * Number(sharePriceBig) / 1e12;

  const { writeContractAsync } = useWriteContract();

  async function handleDeposit() {
    if (!amount || !address) return;
    let amountUsdc6: bigint;
    try {
      amountUsdc6 = parseUnits(amount, 6);
    } catch {
      setError("Invalid amount (max 6 decimal places)");
      return;
    }
    if (amountUsdc6 <= 0n) { setError("Amount must be greater than 0"); return; }

    setError(null);
    setStep("approving");
    try {
      const approveTxHash = await writeContractAsync({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [VAULT_ADDRESS, amountUsdc6],
      });
      await waitForTransactionReceipt(wagmiConfig, { hash: approveTxHash });

      setStep("depositing");
      await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: ThemisVaultABI,
        functionName: "deposit",
        args: [amountUsdc6],
      });
      setAmount("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 80) : "Transaction failed");
    } finally {
      setStep("idle");
    }
  }

  async function handleWithdraw() {
    if (!amount || !address) return;

    let sharesAmount: bigint;
    if (withdrawMode === "shares") {
      try {
        sharesAmount = parseUnits(amount, 6);
      } catch {
        setError("Invalid share amount");
        return;
      }
      if (sharesAmount <= 0n) { setError("Amount must be greater than 0"); return; }
      if (sharesAmount > shareBalance) {
        setError(`Insufficient shares. You have ${formatUnits(shareBalance, 6)} shares.`);
        return;
      }
    } else {
      let usdcAmount: bigint;
      try {
        usdcAmount = parseUnits(amount, 6);
      } catch {
        setError("Invalid amount");
        return;
      }
      if (usdcAmount <= 0n) { setError("Amount must be greater than 0"); return; }

      // Convert USDC to shares: shares = usdcAmount * totalShares / totalAssets
      if (totalAssetsBig === 0n || totalSharesBig === 0n) {
        sharesAmount = usdcAmount;
      } else {
        sharesAmount = (usdcAmount * totalSharesBig) / totalAssetsBig;
      }

      if (sharesAmount > shareBalance) {
        setError(`Insufficient balance. You have $${withdrawableUsdc.toFixed(2)} withdrawable.`);
        return;
      }
      if (sharesAmount === 0n) {
        setError("Amount too small to convert to shares");
        return;
      }
    }

    setError(null);
    setStep("withdrawing");
    try {
      await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: ThemisVaultABI,
        functionName: "withdraw",
        args: [sharesAmount],
      });
      setAmount("");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Transaction failed";
      if (msg.includes("InsufficientLiquidity") || msg.includes("insufficient")) {
        setError("Insufficient liquid reserve — agents have funds deployed. Try again after the cycle settles.");
      } else if (msg.includes("invalid shares")) {
        setError("Share balance mismatch. Refresh and try again.");
      } else {
        setError(msg.slice(0, 120));
      }
    } finally {
      setStep("idle");
    }
  }

  const busy = step !== "idle";
  const reserveLow = liquidReservePct < 25;

  return (
    <div className="border border-ink/30 bg-paper-2">
      <div className="flex items-baseline justify-between border-b border-ink/15 px-4 py-3">
        <h2 className="font-serif text-lg font-semibold text-ink">Back the fund</h2>
        <WalletConnect />
      </div>

      <div className="p-4">
        {/* segmented control */}
        <div className="mb-3.5 inline-flex border border-ink/25">
          {(["deposit", "withdraw"] as const).map(t => (
            <button
              key={t}
              onClick={() => { setTab(t); setAmount(""); setError(null); setWithdrawMode("usdc"); }}
              className={`press px-4 py-1 text-2xs font-semibold uppercase tracking-[0.1em] ${
                tab === t ? "bg-ink text-paper" : "text-ink-3 hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {!isConnected ? (
          <div className="border border-dashed border-ink/25 py-6 text-center font-serif text-base italic text-ink-3">
            Connect a wallet to subscribe.
          </div>
        ) : !vaultConfigured ? (
          <div className="py-4 text-center text-xs text-loss">
            Vault not deployed. Set NEXT_PUBLIC_VAULT_ADDRESS.
          </div>
        ) : (
          <div className="space-y-3">
            {tab === "deposit" && (
              <div className="flex justify-between text-xs text-ink-3">
                <span>Balance <span className="tnum text-ink-2">${usdcBalance.toFixed(2)}</span></span>
                <span>Cap left <span className="tnum text-ink-2">${remaining.toFixed(2)}</span></span>
              </div>
            )}
            {tab === "withdraw" && (
              <div className="flex items-center justify-between text-xs text-ink-3">
                <span>
                  {withdrawMode === "usdc"
                    ? <>Withdrawable <span className="tnum text-ink-2">${withdrawableUsdc.toFixed(2)}</span></>
                    : <>Shares <span className="tnum text-ink-2">{formatUnits(shareBalance, 6)}</span></>
                  }
                </span>
                <div className="flex items-center gap-2">
                  <div className="inline-flex border border-ink/20 text-2xs">
                    {(["usdc", "shares"] as const).map(m => (
                      <button
                        key={m}
                        onClick={() => { setWithdrawMode(m); setAmount(""); setError(null); }}
                        className={`px-2 py-0.5 font-semibold uppercase tracking-[0.08em] ${
                          withdrawMode === m ? "bg-ink text-paper" : "text-ink-3 hover:text-ink"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => setAmount(
                      withdrawMode === "usdc"
                        ? withdrawableUsdc.toFixed(6)
                        : formatUnits(shareBalance, 6)
                    )}
                    className="text-accent hover:underline"
                  >
                    Max
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-baseline border-b border-ink/30 focus-within:border-accent">
              {(tab === "deposit" || withdrawMode === "usdc") && (
                <span className="pointer-events-none font-serif text-2xl text-ink-3">$</span>
              )}
              <input
                type="number"
                inputMode="decimal"
                min="0"
                max={
                  tab === "deposit" ? remaining
                  : withdrawMode === "usdc" ? withdrawableUsdc
                  : Number(formatUnits(shareBalance, 6))
                }
                placeholder={
                  tab === "deposit" ? remaining.toFixed(0)
                  : withdrawMode === "usdc" ? withdrawableUsdc.toFixed(2)
                  : formatUnits(shareBalance, 6)
                }
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full bg-transparent py-1.5 pl-1 font-serif text-2xl tnum text-ink placeholder-ink/25 focus:outline-none"
              />
              <span className="label shrink-0">
                {tab === "deposit" ? "USDC" : withdrawMode === "usdc" ? "USDC" : "shares"}
              </span>
            </div>

            {tab === "deposit" && (
              <div className="flex gap-2">
                {[10, 25, 50].map(v => (
                  <button
                    key={v}
                    onClick={() => setAmount(String(Math.min(v, remaining || v)))}
                    className="press flex-1 border border-ink/20 py-1 font-serif text-sm tnum text-ink-2 hover:border-ink/40 hover:text-ink"
                  >
                    ${v}
                  </button>
                ))}
              </div>
            )}

            {error && (
              <p className="flex items-start gap-1.5 text-xs text-loss" role="alert">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
              </p>
            )}

            <button
              onClick={tab === "deposit" ? handleDeposit : handleWithdraw}
              disabled={busy || !amount}
              className="press inline-flex w-full items-center justify-center gap-2 bg-accent py-2.5 text-2xs font-semibold uppercase tracking-[0.12em] text-paper hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
            >
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy
                ? step === "approving" ? "Approving USDC"
                  : step === "depositing" ? "Depositing"
                  : step === "withdrawing" ? "Withdrawing"
                  : "Pending"
                : tab === "deposit" ? "Approve and deposit"
                : "Withdraw"}
            </button>
          </div>
        )}

        <div className="mt-4 border-t border-ink/15 pt-3">
          <div className="flex items-center justify-between">
            <span className="label">Liquid reserve</span>
            <span className={`font-serif text-sm tnum ${reserveLow ? "text-warn" : "text-ink-2"}`}>
              {liquidReservePct.toFixed(1)}%
            </span>
          </div>
          {reserveLow && <p className="mt-1.5 text-2xs text-warn">Reserve low; large withdrawals may revert.</p>}
          <p className="mt-2 font-serif text-xs italic leading-relaxed text-ink-3">
            Testnet prototype, unaudited. Deposits capped at $100.
          </p>
        </div>
      </div>
    </div>
  );
}
