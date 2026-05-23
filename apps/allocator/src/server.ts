import express from "express";
import { state } from "./state.js";
import { recordSettlement } from "./cycle.js";
import { AgentProposal, AgentId } from "@themis/shared";

export const app = express();
app.use(express.json());

app.post("/proposals", (req, res) => {
  const p = req.body as AgentProposal;
  if (
    !p?.agentId ||
    typeof p.confidence !== "number" ||
    p.confidence < 0 || p.confidence > 1 ||
    typeof p.timestamp !== "number" ||
    typeof p.requestedSizeUsd !== "number" ||
    p.requestedSizeUsd <= 0
  ) {
    return res.status(400).json({ error: "invalid proposal" });
  }
  state.addProposal(p);
  console.log(`[allocator] received proposal from ${p.agentId}: ${p.tradeIdea}`);
  res.json({ ok: true });
});

app.post("/settle", async (req, res) => {
  const { agentId, pnlUsd } = req.body as { agentId: AgentId; pnlUsd: number };
  if (!agentId || typeof pnlUsd !== "number") {
    return res.status(400).json({ error: "invalid settle request" });
  }
  try {
    await recordSettlement(agentId, pnlUsd);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

app.get("/state", (_req, res) => res.json(state.snapshot()));
