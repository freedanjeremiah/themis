import { fetchYieldRates } from "./data.js";
import { reason } from "./reason.js";
import { anchorTrace } from "./anchor.js";
import { submitProposal } from "./propose.js";

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
  } catch (err) {
    console.error("[demeter] cycle error:", err);
  }
}

cycle();
setInterval(cycle, CYCLE_MS);
