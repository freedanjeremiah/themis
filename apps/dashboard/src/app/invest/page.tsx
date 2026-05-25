"use client";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { PageHead } from "../../components/PageHead";
import { OnboardingStrip } from "../../components/OnboardingStrip";
import { useThemisData } from "../../components/DataProvider";

const DepositPanel = dynamic(
  () => import("../../components/DepositPanel").then(m => m.DepositPanel),
  { ssr: false, loading: () => <div className="h-72 border border-ink/30 bg-paper-2" /> }
);

const FACTS = [
  { q: "What am I backing?", a: "Your testnet USDC joins a shared pool that the three agents trade. You receive vault shares in return, representing your portion of the pool." },
  { q: "Can I take it out?", a: "Yes. Withdraw any time, subject to the liquid reserve (the portion not currently deployed in a live trade)." },
  { q: "What's the risk?", a: "This is testnet money with no real value, on unaudited contracts. An agent can lose, and the pool can shrink. Deposits are capped at $100." },
];

export default function InvestPage() {
  const { liquidReservePct } = useThemisData();
  const [prefill, setPrefill] = useState<number | undefined>(undefined);
  const [nonce, setNonce] = useState(0);

  const requestDeposit = useCallback(() => {
    setPrefill(10);
    setNonce(n => n + 1);
  }, []);

  return (
    <div>
      <PageHead title="Invest" intro="Back the fund with testnet USDC. Here is exactly what happens and how to do it." />

      <div className="mb-7">
        <OnboardingStrip onDepositClick={requestDeposit} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.3fr_1fr]">
        {/* Explanation */}
        <div className="space-y-6">
          {FACTS.map(f => (
            <div key={f.q}>
              <h2 className="font-serif text-lg font-medium text-ink">{f.q}</h2>
              <p className="pretty mt-1.5 max-w-[56ch] text-base leading-relaxed text-ink-2">{f.a}</p>
            </div>
          ))}
          <p className="border-t border-ink/15 pt-4 text-xs italic text-ink-3">
            Need testnet USDC first? Connect your wallet, then use the faucet link in the steps above. Funds arrive on Arc, where USDC is also the gas token.
          </p>
        </div>

        {/* The coupon */}
        <div>
          <DepositPanel liquidReservePct={liquidReservePct} prefilledAmount={prefill} prefillNonce={nonce} />
        </div>
      </div>
    </div>
  );
}
