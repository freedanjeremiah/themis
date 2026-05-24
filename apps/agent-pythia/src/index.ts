import { fetchNewsHeadlines, StaleHeadlinesError } from "./data.js";
import { reason } from "./reason.js";
import { anchorTrace } from "./anchor.js";
import { submitProposal, reportSettlement, postStuck } from "./propose.js";
import { executePythiaTrade, PythiaPosition } from "./execute.js";
import { closeHlPosition } from "@themis/hl-client";
import { AGENT_CYCLE_MS, PYTHIA_HOLD_MS } from "@themis/shared";

async function holdAndClose(position: PythiaPosition, allocatedUsd: number): Promise<number | null> {
  await new Promise(r => setTimeout(r, PYTHIA_HOLD_MS));
  const close = await closeHlPosition(
    process.env.PRIVATE_KEY_PYTHIA!,
    position.coin,
    position.sizeInCoins,
    position.szDecimals,
    position.isBuy,
    "pythia",
  ).catch(err => {
    console.warn(`[pythia] HL close failed:`, err);
    return null;
  });
  if (!close) return null;
  const pct = (close.exitPrice - position.fillPrice) / position.fillPrice;
  return pct * allocatedUsd * (position.isBuy ? 1 : -1);
}

async function cycle(): Promise<void> {
  console.log(`[pythia] cycle start ${new Date().toISOString()}`);
  try {
    let news;
    try {
      news = await fetchNewsHeadlines();
    } catch (err) {
      if (err instanceof StaleHeadlinesError) {
        console.warn(`[pythia] skipping cycle: ${err.message}`);
        return;
      }
      throw err;
    }

    const proposal = await reason(news);
    if (proposal.action === "hold") {
      console.log("[pythia] holding this cycle");
      return;
    }

    const { cid, hash } = await anchorTrace(
      { proposal, news },
      proposal.tradeIdea,
      proposal.confidence,
    );

    const { reasoning, ...clean } = proposal;
    clean.reasoningTraceCid = cid;
    clean.reasoningHash = hash;
    clean.timestamp = Math.floor(Date.now() / 1000);

    await submitProposal(clean);
    console.log(`[pythia] submitted: ${clean.tradeIdea}`);

    await new Promise(r => setTimeout(r, 30_000));

    const { ethers } = await import("ethers");
    const pythiaAddress = new ethers.Wallet(process.env.PRIVATE_KEY_PYTHIA!).address;
    const { readAllocatedUsdc } = await import("./vault-read.js");
    const allocatedUsd = await readAllocatedUsdc(pythiaAddress);
    if (allocatedUsd <= 0) {
      console.log(`[pythia] not allocated this cycle (alloc=${allocatedUsd}); skipping execute`);
      await reportSettlement("pythia", 0);
      return;
    }

    const exec = await executePythiaTrade(clean, allocatedUsd);
    if (!exec.ok) {
      if (exec.reason === "real_trades_disabled") {
        await reportSettlement("pythia", 0);
        return;
      }
      console.warn(`[pythia] execute failed: ${exec.reason}`);
      await postStuck("pythia", `execute:${exec.reason}`);
      return;
    }

    const pnlUsd = await holdAndClose(exec.position, allocatedUsd);
    if (pnlUsd === null) {
      await postStuck("pythia", "hl_close_failed");
      return;
    }
    console.log(`[pythia] real HL PnL: $${pnlUsd.toFixed(4)}`);

    await reportSettlement("pythia", pnlUsd);
    console.log(`[pythia] settlement reported: $${pnlUsd.toFixed(4)}`);
  } catch (err) {
    console.error(`[pythia] cycle error:`, err);
    await postStuck("pythia", `unhandled:${(err as Error).message?.slice(0, 80) ?? "unknown"}`).catch(() => {});
  }
}

cycle();
setInterval(cycle, AGENT_CYCLE_MS);
