import type { Config } from "tailwindcss";

/* Editorial ledger: warm paper, sepia-ink text, one iron-ink-blue accent,
   ledger-convention P&L (deep green positive / oxblood-red negative).
   OKLCH with <alpha-value> so /NN opacity modifiers work. */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        serif: ["var(--font-serif)", "Georgia", "serif"],
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
      },
      colors: {
        paper: "oklch(0.977 0.008 85 / <alpha-value>)",
        "paper-2": "oklch(0.952 0.011 82 / <alpha-value>)",
        ink: "oklch(0.24 0.012 60 / <alpha-value>)",
        "ink-2": "oklch(0.42 0.012 60 / <alpha-value>)",
        "ink-3": "oklch(0.54 0.012 60 / <alpha-value>)",
        accent: "oklch(0.42 0.12 255 / <alpha-value>)",
        gain: "oklch(0.48 0.13 150 / <alpha-value>)",
        loss: "oklch(0.47 0.17 27 / <alpha-value>)",
        warn: "oklch(0.52 0.12 66 / <alpha-value>)",
      },
      fontSize: {
        "2xs": ["0.6875rem", { lineHeight: "0.95rem" }],
        xs: ["0.75rem", { lineHeight: "1.05rem" }],
        sm: ["0.8125rem", { lineHeight: "1.2rem" }],
        base: ["0.9375rem", { lineHeight: "1.5rem" }],
        lg: ["1.125rem", { lineHeight: "1.5rem" }],
        xl: ["1.5rem", { lineHeight: "1.7rem" }],
        "2xl": ["2rem", { lineHeight: "2.1rem" }],
        display: ["3.5rem", { lineHeight: "1", letterSpacing: "-0.02em" }],
        masthead: ["1.75rem", { lineHeight: "1", letterSpacing: "0.01em" }],
      },
      borderRadius: {
        none: "0",
        sm: "2px",
        DEFAULT: "3px",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.18s ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
