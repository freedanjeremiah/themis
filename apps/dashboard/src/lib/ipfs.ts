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
  "https://ipfs.io/ipfs",
  "https://dweb.link/ipfs",
  "https://cf-ipfs.com/ipfs",
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

  // Sequential with a per-gateway timeout: only fall through to the next
  // gateway if the current one fails, so a healthy first gateway = one request.
  for (const gw of GATEWAYS) {
    try {
      const resp = await fetch(`${gw}/${normalized}`, {
        signal: AbortSignal.timeout(7_000),
      });
      if (resp.ok) return await resp.json();
    } catch {
      /* try next gateway */
    }
  }
  throw new TraceUnavailableError(`all ${GATEWAYS.length} gateways failed`);
}
