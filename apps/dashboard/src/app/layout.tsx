import type { Metadata } from "next";
import { Newsreader, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "../components/Providers";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { DataProvider } from "../components/DataProvider";
import { AppShell } from "../components/AppShell";

// Editorial serif: masthead, headlines, big numerals, reading prose.
const serif = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-serif",
  display: "swap",
});
// Workhorse sans: small-caps labels, controls, table micro-text.
const sans = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Themis · Ledger of Judgments",
  description: "Multi-agent autonomous fund on Arc testnet",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${serif.variable} ${sans.variable}`}>
      <body className="min-h-dvh bg-paper pb-11 font-sans text-ink antialiased selection:bg-accent/15">
        <ErrorBoundary>
          <Providers>
            <DataProvider>
              <AppShell>{children}</AppShell>
            </DataProvider>
          </Providers>
        </ErrorBoundary>
      </body>
    </html>
  );
}
