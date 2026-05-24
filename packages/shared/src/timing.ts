/**
 * Centralised agent timing constants, env-driven.
 * Defaults match the Phase 2 plan: 20-min cycle, 10-min hold, 10-min CCTP attestation timeout.
 */
export const AGENT_CYCLE_MS = Number(process.env.AGENT_CYCLE_MS ?? 1_200_000);
export const HERMES_HOLD_MS = Number(process.env.HERMES_HOLD_MS ?? 600_000);
export const PYTHIA_HOLD_MS = Number(process.env.PYTHIA_HOLD_MS ?? 600_000);
export const DEMETER_HOLD_MS = Number(process.env.DEMETER_HOLD_MS ?? 900_000);
export const ATTESTATION_TIMEOUT_MS = Number(process.env.ATTESTATION_TIMEOUT_MS ?? 600_000);
