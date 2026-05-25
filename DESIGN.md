# Themis — Design System

## Register
Product. The design serves a live monitoring/decision surface, but takes an **editorial broadsheet** voice: a "ledger of judgments" where agent decisions read like filed dispatches.

## Theme
Light. Scene: a skeptical crypto judge reading the day's filed decisions like a financial broadsheet, indoors, deciding whether to back the fund. Warm paper, never pure white/black. Escapes the crypto dark-terminal reflex deliberately.

## Color — Restrained base + ledger-convention P&L (no gradients, ever)
OKLCH, defined with `<alpha-value>` so opacity modifiers work.
- paper      `oklch(0.977 0.008 85)`  page
- paper-2    `oklch(0.952 0.011 82)`  coupon / inset panels
- ink        `oklch(0.24 0.012 60)`   primary text (sepia-black)
- ink-2      `oklch(0.42 0.012 60)`   secondary
- ink-3      `oklch(0.54 0.012 60)`   tertiary / small-caps labels
- accent     `oklch(0.42 0.12 255)`   iron-ink-blue: primary actions, links, live marker, focus. One accent, not decoration.
- gain       `oklch(0.48 0.13 150)`   positive P&L (deep green)
- loss       `oklch(0.47 0.17 27)`    negative P&L (oxblood red) — ledger convention "in the red"
- warn       `oklch(0.52 0.12 66)`    reserve-low, cautions
Rules/dividers: `border-ink/12`–`/30`. Agents have NO colour; identity is a serif monogram + small-caps name.

## Typography
- **Newsreader** (editorial serif): masthead, section heads, dispatch headlines, big numerals, reading prose. `font-optical-sizing: auto`, italics for datelines.
- **Inter** (sans): small-caps labels (`.label`, 0.6875rem, 600, 0.1em tracking, uppercase), controls, table micro-text.
- Fixed rem scale, perfect-fourth-ish: 2xs .6875 / xs .75 / sm .8125 / base .9375 / lg 1.125 / xl 1.5 / 2xl 2 / display 3.5 / masthead 1.75.
- Tabular lining figures (`.tnum`) on all ledger numbers. `balance` on headlines, `pretty` on prose, prose capped ~68ch.

## Surfaces & layout
- Flat. No cards-by-default, no glass, no gradient, no glow, no drop-shadow decoration.
- Structure via **rules and whitespace**: 2px ink rule under section heads, hairline `divide-y` between dispatches and standings rows, a column rule between the feed and the rail.
- Masthead (wordmark + tagline + dateline) → ruled summary ledger (TVL as display numeral + hairline-divided entries) → subscribe strip → two columns: Reasoning Desk (dispatches) | Standings + Back-the-fund coupon. Fixed "On the wire" ticker at the bottom.
- The coupon is the only bordered box (a genuine distinct, actionable form). Never nest boxes.
- Bans honored: no side-stripe >1px accents, no gradient text, no glassmorphism, no hero-metric SaaS card, no identical card grids.

## Motion
Minimal, state-only, ~150–200ms, ease-out. Reasoning expand fade; live marker ping; count-up on TVL settle. No page-load orchestration. Reduced-motion respected.

## States
Default / hover / focus-visible (2px accent outline) / active (`.press` opacity) / disabled / loading (ink opacity-pulse skeletons, never spinners) / empty ("Waiting for the first dispatch.").
