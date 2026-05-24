"use client";
import { useQuery } from "@tanstack/react-query";
import { fetchTrace } from "../lib/ipfs.js";

/**
 * Lazy IPFS trace fetcher. Only fires when `enabled` is true (default false).
 * Components flip `enabled` when the user expands the "Why?" disclosure.
 *
 * staleTime: Infinity — traces are immutable once anchored, never refetch.
 */
export function useTrace(cid: string, enabled: boolean) {
  return useQuery({
    queryKey: ["trace", cid],
    queryFn: () => fetchTrace(cid),
    enabled: enabled && !!cid,
    staleTime: Infinity,
    retry: false, // fetchTrace already races 3 gateways; no further retry needed
  });
}
