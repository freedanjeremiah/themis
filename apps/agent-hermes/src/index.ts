import { fetchFundingRates } from "./data.js";
import { reason } from "./reason.js";
import { anchorTrace } from "./anchor.js";
import { submitProposal, reportSettlement } from "./propose.js";
import { executeHermesTrade } from "./execute.js";

const CYCLE_MS = 60_000;

async function cycle(): Promise<void> {
  console.log(`[hermes] cycle start ${new Date().toISOString()}`);
  try {
    const data = await fetchFundingRates();
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
    console.log(`[hermes] submitted: ${clean.tradeIdea} (conf=${clean.confidence})`);

    await executeHermesTrade(clean, clean.requestedSizeUsd).catch(err =>
      console.error("[hermes] Execute failed (non-fatal):", err)
    );

    // Simulate settlement: wait 30s then report PnL proportional to confidence
    setTimeout(async () => {
      const direction = clean.action === "hold" ? 0 : (Math.random() > 0.35 ? 1 : -1);
      const pnlUsd = direction * clean.confidence * clean.requestedSizeUsd * 0.005;
      await reportSettlement("hermes", pnlUsd).catch(err =>
        console.error("[hermes] Settlement report failed:", err)
      );
      console.log(`[hermes] Settlement reported: $${pnlUsd.toFixed(4)}`);
    }, 30_000);
  } catch (err) {
    console.error("[hermes] cycle error:", err);
  }
}

cycle();
setInterval(cycle, CYCLE_MS);
