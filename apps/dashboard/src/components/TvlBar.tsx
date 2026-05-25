"use client";
import { useCountUp } from "../hooks/useCountUp";

type Props = {
  tvlUsdc: number;
  depositCount: number;
  liquidReservePct: number;
  activeAgents: number;
  totalAgents: number;
  leaderName: string;
  leaderPct: number;
};

function Entry({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`px-5 ${className}`}>
      <p className="label">{label}</p>
      <div className="mt-1.5 font-serif tnum leading-none text-ink">{children}</div>
    </div>
  );
}

export function TvlBar({ tvlUsdc, depositCount, liquidReservePct, activeAgents, totalAgents, leaderName, leaderPct }: Props) {
  const tvl = useCountUp(tvlUsdc / 1e6);
  const [whole, frac] = tvl
    .toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    .split(".");
  const reserveLow = liquidReservePct < 25;
  const leaderUp = leaderPct >= 0;

  return (
    <div className="flex flex-wrap items-stretch border-y-2 border-ink py-5">
      <Entry label="Total value locked" className="grow">
        <span className="text-display">
          <span className="text-ink-3">$</span>{whole}<span className="text-[2.25rem] text-ink-3">.{frac}</span>
        </span>
      </Entry>
      <Entry label="Depositors" className="flex flex-col justify-end border-l border-ink/15">
        <span className="text-2xl">{depositCount}</span>
      </Entry>
      <Entry label="Liquid reserve" className="flex flex-col justify-end border-l border-ink/15">
        <span className={`text-2xl ${reserveLow ? "text-warn" : ""}`}>{liquidReservePct.toFixed(0)}%</span>
      </Entry>
      <Entry label="Agents working" className="flex flex-col justify-end border-l border-ink/15">
        <span className="text-2xl">{activeAgents}<span className="text-xl text-ink-3">/{totalAgents}</span></span>
      </Entry>
      <Entry label="Leader" className="flex flex-col justify-end border-l border-ink/15">
        <span className="flex items-baseline gap-2 text-2xl">
          {leaderName}
          <span className={`text-lg ${leaderUp ? "text-gain" : "text-loss"}`}>
            {leaderUp ? "+" : "−"}{Math.abs(leaderPct).toFixed(2)}%
          </span>
        </span>
      </Entry>
    </div>
  );
}
