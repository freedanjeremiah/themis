import { fetchYieldRates } from "./data.js";
import { reason } from "./reason.js";
import { anchorTrace } from "./anchor.js";
import { submitProposal, reportSettlement } from "./propose.js";
import { executeDemeterRotation } from "./execute.js";

const CYCLE_MS = 60_000;

async function cycle(): Promise<void> {
  console.log(`[demeter] cycle start ${new Date().toISOString()}`);
  try {
    const data = await fetchYieldRates();
    const proposal = await reason(data);

    const { cid, hash } = await anchorTrace(
      { proposal, data },
      proposal.tradeIdea,
      proposal.confidence
    );

    const { reasoning, ...clean } = proposal;
    clean.reasoningTraceCid = cid;
    clean.reasoningHash = hash;
    clean.timestamp = Math.floor(Date.now() / 1000);

    await submitProposal(clean);
    console.log(`[demeter] submitted: ${clean.tradeIdea}`);

    await executeDemeterRotation(clean, clean.requestedSizeUsd).catch(err =>
      console.error("[demeter] Execute failed (non-fatal):", err)
    );

    // Report simulated yield settlement after 45s (yield accrues slower than perp trades)
    setTimeout(async () => {
      // Simulate: APY-based yield for the cycle window (1 min ≈ 1/525600 of a year)
      const apyFraction = clean.confidence * 0.055; // ~5.5% APY scaled by confidence
      const cycleYieldUsd = clean.requestedSizeUsd * apyFraction / 525_600;
      await reportSettlement("demeter", cycleYieldUsd).catch(err =>
        console.error("[demeter] Settlement report failed:", err)
      );
      console.log(`[demeter] Yield settlement reported: $${cycleYieldUsd.toFixed(6)} (APY ~${(apyFraction * 100).toFixed(2)}%)`);
    }, 45_000);
  } catch (err) {
    console.error("[demeter] cycle error:", err);
  }
}

cycle();
setInterval(cycle, CYCLE_MS);
