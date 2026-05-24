import { fetchFundingRates } from "./data.js";
import { reason } from "./reason.js";
import { anchorTrace } from "./anchor.js";
import { submitProposal, reportSettlement, postStuck } from "./propose.js";
import { executeHermesTrade, HermesPosition } from "./execute.js";
import { closeHlPosition } from "@themis/hl-client";
import { bridgeHlToArc } from "./cctp.js";
import { AGENT_CYCLE_MS, HERMES_HOLD_MS } from "@themis/shared";

async function holdAndClose(position: HermesPosition, allocatedUsd: number): Promise<number | null> {
  await new Promise(r => setTimeout(r, HERMES_HOLD_MS));
  const close = await closeHlPosition(
    process.env.PRIVATE_KEY_HERMES!,
    position.coin,
    position.sizeInCoins,
    position.szDecimals,
    position.isBuy,
    "hermes",
  ).catch(err => {
    console.warn(`[hermes] HL close failed:`, err);
    return null;
  });
  if (!close) return null;
  const pct = (close.exitPrice - position.fillPrice) / position.fillPrice;
  return pct * allocatedUsd * (position.isBuy ? 1 : -1);
}

async function cycle(): Promise<void> {
  console.log(`[hermes] cycle start ${new Date().toISOString()}`);
  try {
    const data = await fetchFundingRates();
    const proposal = await reason(data);

    const { cid, hash } = await anchorTrace(
      { proposal, data },
      proposal.tradeIdea,
      proposal.confidence,
    );

    const { reasoning, ...clean } = proposal;
    clean.reasoningTraceCid = cid;
    clean.reasoningHash = hash;
    clean.timestamp = Math.floor(Date.now() / 1000);

    await submitProposal(clean);
    console.log(`[hermes] submitted: ${clean.tradeIdea} (conf=${clean.confidence})`);

    // Wait briefly for the allocator to score + call vault.allocate, then act.
    await new Promise(r => setTimeout(r, 30_000));

    const { ethers } = await import("ethers");
    const hermesAddress = new ethers.Wallet(process.env.PRIVATE_KEY_HERMES!).address;
    const { readAllocatedUsdc } = await import("./vault-read.js");
    const allocatedUsd = await readAllocatedUsdc(hermesAddress);
    if (allocatedUsd <= 0) {
      console.log(`[hermes] not allocated this cycle (alloc=${allocatedUsd}); skipping execute`);
      await reportSettlement("hermes", 0);
      return;
    }

    const exec = await executeHermesTrade(clean, allocatedUsd);
    if (!exec.ok) {
      if (exec.reason === "real_trades_disabled") {
        await reportSettlement("hermes", 0);
        return;
      }
      console.warn(`[hermes] execute failed: ${exec.reason} (burn=${exec.burnTxHash ?? "n/a"})`);
      await postStuck("hermes", `execute:${exec.reason}${exec.burnTxHash ? `:${exec.burnTxHash}` : ""}`);
      return;
    }

    const pnlUsd = await holdAndClose(exec.position, allocatedUsd);
    if (pnlUsd === null) {
      await postStuck("hermes", "hl_close_failed");
      return;
    }
    console.log(`[hermes] real HL PnL: $${pnlUsd.toFixed(4)}`);

    // Bridge proceeds back so the vault can pull on settle.
    const proceedsUsd = allocatedUsd + pnlUsd;
    const proceedsUsd6 = BigInt(Math.max(0, Math.floor(proceedsUsd * 1_000_000)));
    if (proceedsUsd6 > 0n) {
      const back = await bridgeHlToArc(proceedsUsd6);
      if (back.status !== "complete") {
        await postStuck("hermes", `reverse_bridge:${back.status}:${back.burnTxHash}`);
        return;
      }
    }

    await reportSettlement("hermes", pnlUsd);
    console.log(`[hermes] settlement reported: $${pnlUsd.toFixed(4)}`);
  } catch (err) {
    console.error(`[hermes] cycle error:`, err);
    await postStuck("hermes", `unhandled:${(err as Error).message?.slice(0, 80) ?? "unknown"}`).catch(() => {});
  }
}

cycle();
setInterval(cycle, AGENT_CYCLE_MS);
