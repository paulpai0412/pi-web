"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PiSessionLine {
  id: string;
  text: string;
  tone?: "error" | "warning" | "info";
}

export function usePiSessionSse(sessionId: string | null) {
  const [lines, setLines] = useState<PiSessionLine[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRef = useRef(false);

  const push = useCallback((line: PiSessionLine) => {
    setLines((prev) => [...prev, line]);
  }, []);

  const clear = useCallback(() => {
    setLines([]);
  }, []);

  const reconnectNow = useCallback(() => {
    setReconnectAttempts(0);
    setReconnectNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    esRef.current?.close();
    if (timerRef.current) clearTimeout(timerRef.current);

    setLines([]);
    setIsLive(false);
    setIsReconnecting(false);
    setReconnectAttempts(0);
    setError(null);
    setEnded(false);
    stopRef.current = false;

    if (!sessionId) return;

    let disposed = false;
    let attempts = 0;

    const connect = () => {
      if (disposed || !sessionId || stopRef.current) return;

      const url = `/api/agent/${encodeURIComponent(sessionId)}/events`;
      const es = new EventSource(url);
      esRef.current = es;

      es.onopen = () => {
        if (disposed) return;
        attempts = 0;
        setReconnectAttempts(0);
        setIsLive(true);
        setIsReconnecting(false);
        setError(null);
      };

      es.onmessage = (e) => {
        if (disposed) return;

        const event = JSON.parse(e.data as string) as {
          type: string;
          delta?: string;
          message?: string;
        };

        if (event.type === "connected") return;

        if (event.type === "text_delta" && typeof event.delta === "string") {
          push({ id: `txt-${Date.now()}-${Math.random()}`, text: event.delta, tone: "info" });
          return;
        }

        if (event.type === "agent_end") {
          stopRef.current = true;
          setEnded(true);
          setIsLive(false);
          setIsReconnecting(false);
          es.close();
          return;
        }

        if (event.type === "error" || event.type === "agent_error") {
          push({
            id: `err-${Date.now()}-${Math.random()}`,
            text: event.message ?? event.type,
            tone: "error",
          });
          return;
        }

        push({ id: `evt-${Date.now()}-${Math.random()}`, text: event.type, tone: "warning" });
      };

      es.onerror = () => {
        es.close();
        if (disposed || stopRef.current) return;

        attempts += 1;
        setIsLive(false);
        setIsReconnecting(true);
        setReconnectAttempts(attempts);
        setError("SSE disconnected");

        timerRef.current = setTimeout(connect, 2000);
      };
    };

    connect();

    return () => {
      disposed = true;
      esRef.current?.close();
      if (timerRef.current) clearTimeout(timerRef.current);
      setIsLive(false);
      setIsReconnecting(false);
    };
  }, [push, reconnectNonce, sessionId]);

  return {
    lines,
    isLive,
    isReconnecting,
    reconnectAttempts,
    error,
    ended,
    reconnectNow,
    clear,
  };
}
