import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchYieldRates } from "./data.js";
import { reason } from "./reason.js";
import { anchorTrace } from "./anchor.js";
import { submitProposal, reportSettlement } from "./propose.js";
import { depositToVenue, redeemFromVenue } from "./execute.js";
import { AGENT_CYCLE_MS, DEMETER_HOLD_MS } from "@themis/shared";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHARES_PATH = join(__dirname, "../.shares-held.json");

type ShareSlot = { venue: string; sharesHeld: string; depositedUsd6: string; openedAt: number };

function readShareSlot(): ShareSlot | null {
  if (!existsSync(SHARES_PATH)) return null;
  try { return JSON.parse(readFileSync(SHARES_PATH, "utf8")) as ShareSlot; } catch { return null; }
}
function writeShareSlot(slot: ShareSlot | null): void {
  if (!slot) {
    try { writeFileSync(SHARES_PATH, "null"); } catch { /* ignore */ }
    return;
  }
  writeFileSync(SHARES_PATH, JSON.stringify(slot));
}

async function postStuck(reason: string | null): Promise<void> {
  const url = `${process.env.ALLOCATOR_URL ?? "http://localhost:3001"}/stuck`;
  await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId: "demeter", reason }),
  }).catch(err => console.warn(`[demeter] postStuck failed:`, err));
}

async function cycle(): Promise<void> {
  console.log(`[demeter] cycle start ${new Date().toISOString()}`);
  try {
    const data = await fetchYieldRates();
    const proposal = await reason(data);

    const { cid, hash } = await anchorTrace(
      { proposal, data }, proposal.tradeIdea, proposal.confidence,
    );

    const { reasoning, ...clean } = proposal;
    clean.reasoningTraceCid = cid;
    clean.reasoningHash = hash;
    clean.timestamp = Math.floor(Date.now() / 1000);

    await submitProposal(clean);
    console.log(`[demeter] submitted: ${clean.tradeIdea}`);

    // Wait for allocator scoring + vault.allocate
    await new Promise(r => setTimeout(r, 70_000));

    const { ethers } = await import("ethers");
    const demeterAddress = new ethers.Wallet(process.env.PRIVATE_KEY_DEMETER!).address;
    const { readAllocatedUsdc } = await import("./vault-read.js");
    const allocatedUsd = await readAllocatedUsdc(demeterAddress);
    if (allocatedUsd <= 0) {
      console.log(`[demeter] not allocated this cycle (alloc=${allocatedUsd}); skipping deposit`);
      return;
    }

    const dep = await depositToVenue(clean, allocatedUsd);
    if (!dep.ok) {
      if (dep.reason === "real_trades_disabled") return;
      await postStuck(`deposit:${dep.reason}`);
      return;
    }

    writeShareSlot({
      venue: dep.venue,
      sharesHeld: dep.sharesHeld.toString(),
      depositedUsd6: dep.depositedUsd6.toString(),
      openedAt: Date.now(),
    });

    // Hold then redeem.
    await new Promise(r => setTimeout(r, DEMETER_HOLD_MS));

    const slot = readShareSlot();
    if (!slot) {
      await postStuck("shares_slot_missing_on_redeem");
      return;
    }
    const red = await redeemFromVenue(slot.venue, BigInt(slot.sharesHeld), BigInt(slot.depositedUsd6));
    if (!red.ok) {
      await postStuck(`redeem:${red.reason}`);
      return;
    }
    writeShareSlot(null);

    const pnlUsd = Number(red.receivedUsd6 - BigInt(slot.depositedUsd6)) / 1_000_000;
    await reportSettlement("demeter", pnlUsd);
    console.log(`[demeter] real yield settlement: $${pnlUsd.toFixed(6)} (delta over $${(Number(BigInt(slot.depositedUsd6)) / 1_000_000).toFixed(2)})`);
  } catch (err) {
    console.error(`[demeter] cycle error:`, err);
    await postStuck(`unhandled:${(err as Error).message?.slice(0, 80) ?? "unknown"}`).catch(() => {});
  }
}

cycle();
setInterval(cycle, AGENT_CYCLE_MS);
