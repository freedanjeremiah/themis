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
  // Read localStorage AFTER mount to avoid SSR mismatch
  useEffect(() => { setHidden(readDismissed()); }, []);

  if (hidden) return null;
  return (
    <div className="bg-yellow-950 border-b border-yellow-700 text-yellow-200 text-xs px-4 py-2 flex items-center justify-between">
      <span>
        <strong>Arc testnet — testnet USDC only — not real money.</strong> Hackathon prototype, unaudited.
      </span>
      <button
        onClick={() => { setHidden(true); writeDismissed(); }}
        className="text-yellow-400 hover:text-yellow-200 ml-4 font-mono"
        aria-label="Dismiss banner"
      >
        ×
      </button>
    </div>
  );
}
