/**
 * Fetch a trace JSON object by IPFS CID, racing multiple gateways.
 * The first 200 OK wins. Throws if all gateways fail.
 *
 * CID may be supplied as:
 *   - `ipfs://Qm...` (preferred from agents)
 *   - `hash://...` (sentinel for traces that never made it to IPFS; throws immediately)
 *   - bare `Qm...` (treated as IPFS)
 */
const GATEWAYS = [
  "https://gateway.pinata.cloud/ipfs",
  "https://ipfs.io/ipfs",
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

  const attempts = GATEWAYS.map(async (gw) => {
    const resp = await fetch(`${gw}/${normalized}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) throw new Error(`${gw}: HTTP ${resp.status}`);
    return resp.json();
  });

  try {
    return await Promise.any(attempts);
  } catch {
    throw new TraceUnavailableError(
      `all ${GATEWAYS.length} gateways failed`
    );
  }
}
