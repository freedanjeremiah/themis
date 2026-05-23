import { fetchFundingRates } from "./data.js";
import { reason } from "./reason.js";
import { anchorTrace } from "./anchor.js";
import { submitProposal } from "./propose.js";

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
  } catch (err) {
    console.error("[hermes] cycle error:", err);
  }
}

cycle();
setInterval(cycle, CYCLE_MS);
