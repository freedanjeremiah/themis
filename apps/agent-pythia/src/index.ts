import { fetchNewsHeadlines } from "./data.js";
import { reason } from "./reason.js";
import { anchorTrace } from "./anchor.js";
import { submitProposal, reportSettlement, postStuck } from "./propose.js";
import { executePythiaTrade, PythiaPosition } from "./execute.js";
import { closeHlPosition } from "@themis/hl-client";
import { bridgeHlToArc } from "./cctp.js";
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
    const news = await fetchNewsHeadlines();
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

    const exec = await executePythiaTrade(clean, clean.requestedSizeUsd);
    if (!exec.ok) {
      if (exec.reason === "real_trades_disabled") {
        await reportSettlement("pythia", 0);
        return;
      }
      console.warn(`[pythia] execute failed: ${exec.reason} (burn=${exec.burnTxHash ?? "n/a"})`);
      await postStuck("pythia", `execute:${exec.reason}${exec.burnTxHash ? `:${exec.burnTxHash}` : ""}`);
      return;
    }

    const pnlUsd = await holdAndClose(exec.position, clean.requestedSizeUsd);
    if (pnlUsd === null) {
      await postStuck("pythia", "hl_close_failed");
      return;
    }
    console.log(`[pythia] real HL PnL: $${pnlUsd.toFixed(4)}`);

    const proceedsUsd = clean.requestedSizeUsd + pnlUsd;
    const proceedsUsd6 = BigInt(Math.max(0, Math.floor(proceedsUsd * 1_000_000)));
    if (proceedsUsd6 > 0n) {
      const back = await bridgeHlToArc(proceedsUsd6);
      if (back.status !== "complete") {
        await postStuck("pythia", `reverse_bridge:${back.status}:${back.burnTxHash}`);
        return;
      }
    }

    await reportSettlement("pythia", pnlUsd);
    console.log(`[pythia] settlement reported: $${pnlUsd.toFixed(4)}`);
  } catch (err) {
    console.error(`[pythia] cycle error:`, err);
    await postStuck("pythia", `unhandled:${(err as Error).message?.slice(0, 80) ?? "unknown"}`).catch(() => {});
  }
}

cycle();
setInterval(cycle, AGENT_CYCLE_MS);
