"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DisclaimerBanner } from "./DisclaimerBanner";
import { WalletConnect } from "./WalletConnect";
import { WsStatusIndicator } from "./WsStatusIndicator";
import { ActivityTicker } from "./ActivityTicker";
import { useThemisData } from "./DataProvider";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/agents", label: "Agents" },
  { href: "/desk", label: "The Desk" },
  { href: "/how", label: "How it works" },
  { href: "/invest", label: "Invest" },
];

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { wsState, feed } = useThemisData();
  const [today, setToday] = useState("");

  useEffect(() => {
    setToday(new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
  }, []);

  return (
    <>
      <DisclaimerBanner />

      <header className="mx-auto max-w-6xl px-5 pt-6">
        <div className="flex items-end justify-between gap-4">
          <Link href="/" className="press ulink font-serif text-[2.75rem] font-bold leading-none tracking-tight text-ink">
            Themis
          </Link>
          <div className="flex items-center gap-4 pb-1">
            <WsStatusIndicator state={wsState} />
            <WalletConnect />
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between border-t-2 border-ink pt-1.5">
          <p className="font-serif text-sm italic text-ink-2">A ledger of autonomous judgment, settled on-chain.</p>
          <p className="label">{today || "Testnet Edition"} · Arc</p>
        </div>

        {/* Section navigation */}
        <nav className="mt-2 flex flex-wrap gap-x-6 gap-y-1 border-b border-ink/15 pb-2.5">
          {NAV.map(item => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                data-active={active}
                className={`press ulink text-2xs font-semibold uppercase tracking-[0.12em] ${
                  active ? "text-accent" : "text-ink-3 hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-5 py-7">{children}</main>

      <ActivityTicker feed={feed} />
    </>
  );
}
