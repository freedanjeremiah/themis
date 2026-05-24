import axios from "axios";
import { AgentProposal } from "@themis/shared";
import * as dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

const ALLOCATOR_URL = process.env.ALLOCATOR_URL ?? "http://localhost:3001";

export async function submitProposal(proposal: AgentProposal): Promise<void> {
  await axios.post(`${ALLOCATOR_URL}/proposals`, proposal);
}

export async function reportSettlement(agentId: string, pnlUsd: number): Promise<void> {
  await axios.post(`${ALLOCATOR_URL}/settle`, { agentId, pnlUsd });
}

export async function postStuck(agentId: string, reason: string | null): Promise<void> {
  const url = `${ALLOCATOR_URL}/stuck`;
  await axios.post(url, { agentId, reason }).catch(err =>
    console.warn(`[pythia] postStuck failed:`, err)
  );
}
