"use client";
import { useState } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
} from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { parseUnits, formatUnits } from "viem";
import { VAULT_ABI, ERC20_ABI, USDC_ADDRESS } from "../lib/abis";
import { wagmiConfig } from "../lib/wagmi";
import { WalletConnect } from "./WalletConnect";

const VAULT_ADDRESS = (
  process.env.NEXT_PUBLIC_VAULT_ADDRESS ??
  "0x0000000000000000000000000000000000000000"
) as `0x${string}`;
const WALLET_CAP_USDC = 100; // $100

export function DepositPanel({ liquidReservePct }: { liquidReservePct: number }) {
  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<"idle" | "approving" | "depositing" | "withdrawing">("idle");
  const [error, setError] = useState<string | null>(null);
  const { address, isConnected } = useAccount();

  const { data: depositedRaw } = useReadContract({
    address: VAULT_ADDRESS,
    abi: VAULT_ABI,
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

  const deposited = depositedRaw ? Number(formatUnits(depositedRaw as bigint, 6)) : 0;
  const usdcBalance = usdcBalanceRaw ? Number(formatUnits(usdcBalanceRaw as bigint, 6)) : 0;
  const remaining = Math.max(0, WALLET_CAP_USDC - deposited);

  const { writeContractAsync } = useWriteContract();

  async function handleDeposit() {
    if (!amount || !address) return;
    let amountUsdc6: bigint;
    try {
      amountUsdc6 = parseUnits(amount, 6);
    } catch {
      setError("Invalid amount — max 6 decimal places");
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
        abi: VAULT_ABI,
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
    try {
      sharesAmount = parseUnits(amount, 6);
    } catch {
      setError("Invalid amount");
      return;
    }
    setError(null);
    setStep("withdrawing");
    try {
      await writeContractAsync({
        address: VAULT_ADDRESS,
        abi: VAULT_ABI,
        functionName: "withdraw",
        args: [sharesAmount],
      });
      setAmount("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.slice(0, 80) : "Transaction failed");
    } finally {
      setStep("idle");
    }
  }

  const busy = step !== "idle";

  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
          {tab === "deposit" ? "Deposit" : "Withdraw"}
        </h2>
        <WalletConnect />
      </div>

      <div className="flex gap-2 mb-4">
        {(["deposit", "withdraw"] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setAmount(""); }}
            className={`flex-1 py-1.5 rounded text-sm font-medium transition-colors ${
              tab === t ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white bg-gray-800"
            }`}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {!isConnected ? (
        <div className="text-center text-gray-500 text-sm py-6 border border-dashed border-gray-700 rounded">
          Connect wallet to deposit USDC
        </div>
      ) : (
        <div className="space-y-3">
          {tab === "deposit" && (
            <p className="text-xs text-gray-500">
              Balance: <span className="text-gray-300">${usdcBalance.toFixed(2)}</span>
              {" · "}Cap remaining: <span className="text-gray-300">${remaining.toFixed(2)}</span>
            </p>
          )}
          <input
            type="number"
            min="0"
            max={tab === "deposit" ? remaining : undefined}
            placeholder={
              tab === "deposit"
                ? `Amount USDC (max $${remaining.toFixed(0)})`
                : "Shares to burn"
            }
            value={amount}
            onChange={e => setAmount(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={tab === "deposit" ? handleDeposit : handleWithdraw}
            disabled={busy || !amount}
            className="w-full py-2 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {busy
              ? step === "approving"
                ? "Approving USDC…"
                : step === "depositing"
                ? "Depositing…"
                : step === "withdrawing"
                ? "Withdrawing…"
                : "Pending…"
              : tab === "deposit"
              ? "Approve & Deposit"
              : "Withdraw"}
          </button>
        </div>
      )}

      <div className="mt-3 space-y-1">
        <p className="text-xs text-gray-500">
          Liquid reserve:{" "}
          <span className={liquidReservePct < 25 ? "text-yellow-400" : "text-gray-400"}>
            {liquidReservePct.toFixed(1)}%
          </span>
          {liquidReservePct < 25 && (
            <span className="block text-yellow-500">
              Reserve low — large withdrawals may revert
            </span>
          )}
        </p>
        <p className="text-xs text-red-500/70">
          Hackathon prototype — unaudited — deposits capped at $100
        </p>
      </div>
    </div>
  );
}
