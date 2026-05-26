/**
 * Fetch a trace JSON object by IPFS CID. Tries public gateways in order and
 * returns the first 200 OK — sequential, so the common case is a single request.
 *
 * Pinata is deliberately NOT in this list: it's reserved for *pinning* (the
 * agents), and reading through its gateway burns the free request quota.
 *
 * CID may be supplied as:
 *   - `ipfs://Qm...` (preferred from agents)
 *   - `hash://...` (sentinel for traces that never made it to IPFS; throws immediately)
 *   - bare `Qm...` (treated as IPFS)
 */
const GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs", // content was pinned here — fastest
  "https://ipfs.io/ipfs",
  "https://dweb.link/ipfs",
];

export class TraceUnavailableError extends Error {
  constructor(reason: string) {
    super(`Trace unavailable: ${reason}`);
  }
}

export function normalizeCid(cid: string): string | null {
  if (!cid) return null;
  if (cid.startsWith("hash://")) return null; // sentinel — never published
  if (cid.startsWith("ipfs://")) return cid.slice(7);
  return cid;
}

export async function fetchTrace(cid: string): Promise<unknown> {
  const normalized = normalizeCid(cid);
  if (!normalized)
    throw new TraceUnavailableError("not published to IPFS");

  // Race all gateways in parallel; first 200 OK wins.
  const attempts = GATEWAYS.map(async (gw) => {
    const resp = await fetch(`${gw}/${normalized}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`${gw} ${resp.status}`);
    return resp.json() as Promise<unknown>;
  });

  try {
    return await Promise.any(attempts);
  } catch {
    throw new TraceUnavailableError(`all ${GATEWAYS.length} gateways failed`);
  }
}
