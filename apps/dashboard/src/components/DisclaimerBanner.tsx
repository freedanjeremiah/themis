"use client";
import { useEffect, useState } from "react";

const STORAGE_KEY = "themis_disclaimer_dismissed_v1";

function readDismissed(): boolean {
  if (typeof window === "undefined") return false;
  try { return window.localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; }
}
function writeDismissed(): void {
  try { window.localStorage.setItem(STORAGE_KEY, "1"); } catch { /* private-mode: ignore */ }
}

export function DisclaimerBanner() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => { setHidden(readDismissed()); }, []);

  if (hidden) return null;
  return (
    <div className="flex items-center justify-center gap-3 border-b border-ink/15 bg-paper-2 px-4 py-1.5 text-center">
      <p className="text-2xs uppercase tracking-[0.08em] text-ink-2">
        Arc testnet · testnet USDC only, not real money · hackathon prototype, unaudited
      </p>
      <button
        onClick={() => { setHidden(true); writeDismissed(); }}
        className="press text-sm text-ink-3 hover:text-ink"
        aria-label="Dismiss notice"
      >
        ×
      </button>
    </div>
  );
}
