"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchTrace } from "../lib/ipfs";

/**
 * Lazy IPFS trace fetcher. Only fires when `enabled` is true (default false).
 * Components flip `enabled` when the user expands the "Why?" disclosure.
 *
 * staleTime + gcTime Infinity — traces are immutable once anchored, so a CID is
 * fetched at most once per session even if the disclosure is reopened or remounted.
 */
export function useTrace(cid: string, enabled: boolean) {
  return useQuery({
    queryKey: ["trace", cid],
    queryFn: () => fetchTrace(cid),
    enabled: enabled && !!cid,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false, // fetchTrace already falls through gateways; no further retry needed
  });
}
