"use client";
import { useEffect } from "react";
import { WsMessage } from "@themis/shared";

export function useIndexerSocket(onMessage: (msg: WsMessage) => void) {
  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_INDEXER_WS_URL ?? "ws://localhost:3002";
    const ws = new WebSocket(url);
    ws.onmessage = e => {
      try {
        onMessage(JSON.parse(e.data));
      } catch {}
    };
    ws.onerror = () => console.warn("[dashboard] WS error");
    return () => ws.close();
  }, [onMessage]);
}
