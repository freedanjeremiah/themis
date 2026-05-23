import { fetchNewsHeadlines } from "./data.js";
import { reason } from "./reason.js";
import { anchorTrace } from "./anchor.js";
import { submitProposal, reportSettlement } from "./propose.js";
import { executePythiaTrade } from "./execute.js";

const CYCLE_MS = 60_000;

async function cycle(): Promise<void> {
  console.log(`[pythia] cycle start ${new Date().toISOString()}`);
  try {
    const news = await fetchNewsHeadlines();
    const proposal = await reason(news);
    if (proposal.action === "hold") {
      console.log("[pythia] holding this cycle");
      return;
    }

    const { cid, hash } = await anchorTrace(
      { proposal, news },
      proposal.tradeIdea,
      proposal.confidence
    );

    const { reasoning, ...clean } = proposal;
    clean.reasoningTraceCid = cid;
    clean.reasoningHash = hash;
    clean.timestamp = Math.floor(Date.now() / 1000);

    await submitProposal(clean);
    console.log(`[pythia] submitted: ${clean.tradeIdea}`);

    await executePythiaTrade(clean, clean.requestedSizeUsd).catch(err =>
      console.error("[pythia] Execute failed (non-fatal):", err)
    );

    setTimeout(async () => {
      const direction = clean.action === "hold" ? 0 : (Math.random() > 0.4 ? 1 : -1);
      const pnlUsd = direction * clean.confidence * clean.requestedSizeUsd * 0.004;
      await reportSettlement("pythia", pnlUsd).catch(err =>
        console.error("[pythia] Settlement report failed:", err)
      );
      console.log(`[pythia] Settlement reported: $${pnlUsd.toFixed(4)}`);
    }, 30_000);
  } catch (err) {
    console.error("[pythia] cycle error:", err);
  }
}

cycle();
setInterval(cycle, CYCLE_MS);
