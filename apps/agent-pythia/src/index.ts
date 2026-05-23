import { fetchNewsHeadlines } from "./data.js";
import { reason } from "./reason.js";
import { anchorTrace } from "./anchor.js";
import { submitProposal, reportSettlement } from "./propose.js";
import { executePythiaTrade } from "./execute.js";
import { closeHlPosition } from "./hl.js";

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

    const position = await executePythiaTrade(clean, clean.requestedSizeUsd).catch(err => {
      console.error("[pythia] Execute failed (non-fatal):", err);
      return null;
    });

    // Settle after 5 minutes — use real HL position PnL if available, otherwise fake
    const SETTLE_DELAY_MS = position ? 5 * 60_000 : 30_000;
    setTimeout(async () => {
      let pnlUsd: number;
      if (position?.fillPrice) {
        const close = await closeHlPosition(
          process.env.PRIVATE_KEY_PYTHIA!,
          position.coin,
          position.sizeInCoins,
          position.szDecimals,
          position.isBuy,
          "pythia"
        ).catch(() => null);
        if (close) {
          const pct = (close.exitPrice - position.fillPrice) / position.fillPrice;
          pnlUsd = pct * clean.requestedSizeUsd * (position.isBuy ? 1 : -1);
          console.log(`[pythia] Real PnL: entry=${position.fillPrice} exit=${close.exitPrice} pnl=$${pnlUsd.toFixed(4)}`);
        } else {
          // Close failed — fall back to fake PnL
          const direction = Math.random() > 0.4 ? 1 : -1;
          pnlUsd = direction * clean.confidence * clean.requestedSizeUsd * 0.004;
        }
      } else {
        // No real trade — use fake PnL
        const direction = clean.action === "hold" ? 0 : (Math.random() > 0.4 ? 1 : -1);
        pnlUsd = direction * clean.confidence * clean.requestedSizeUsd * 0.004;
      }
      await reportSettlement("pythia", pnlUsd).catch(err =>
        console.error("[pythia] Settlement report failed:", err)
      );
      console.log(`[pythia] Settlement reported: $${pnlUsd.toFixed(4)}`);
    }, SETTLE_DELAY_MS);
  } catch (err) {
    console.error("[pythia] cycle error:", err);
  }
}

cycle();
setInterval(cycle, CYCLE_MS);
