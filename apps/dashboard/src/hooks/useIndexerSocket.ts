"use client";
import { useEffect, useRef, useCallback } from "react";
import { WsMessage } from "@themis/shared";

export function useIndexerSocket(onMessage: (msg: WsMessage) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const wsRef     = useRef<WebSocket | null>(null);
  const retryRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const delayRef  = useRef(1000);
  const unmounted = useRef(false);

  const connect = useCallback(() => {
    if (unmounted.current) return;

    const url = process.env.NEXT_PUBLIC_INDEXER_WS_URL ?? "ws://localhost:3002";
    const ws  = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      delayRef.current = 1000; // reset backoff on successful connect
    };

    ws.onmessage = (e) => {
      try { onMessageRef.current(JSON.parse(e.data) as WsMessage); } catch {}
    };

    ws.onerror = () => {
      console.warn("[dashboard] WebSocket error — will reconnect");
    };

    ws.onclose = () => {
      if (unmounted.current) return;
      const delay = delayRef.current;
      delayRef.current = Math.min(delay * 2, 30_000);
      console.log(`[dashboard] WebSocket closed — reconnecting in ${delay}ms`);
      retryRef.current = setTimeout(connect, delay);
    };
  }, []);

  useEffect(() => {
    unmounted.current = false;
    connect();
    return () => {
      unmounted.current = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
