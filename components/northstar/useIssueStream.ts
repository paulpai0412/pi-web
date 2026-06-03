"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { NorthstarRunEvent } from "@/lib/northstar/types";

export interface StreamLine {
  id: string;
  text: string;
  severity?: "info" | "warning" | "error";
  timestamp?: string;
  isStderr?: boolean;
}

export type StreamMode =
  | { type: "run"; url: string }           // CLI via /run SSE
  | { type: "pi"; sessionId: string }      // pi agent /api/agent/{id}/events
  | { type: "poll"; eventsUrl: string }    // SQLite history poll
  | { type: "idle" };

// Stable key derived from mode so useEffect doesn't fire on every render
function modeKey(mode: StreamMode): string {
  if (mode.type === "run") return `run:${mode.url}`;
  if (mode.type === "pi") return `pi:${mode.sessionId}`;
  if (mode.type === "poll") return `poll:${mode.eventsUrl}`;
  return "idle";
}

export function useIssueStream(mode: StreamMode) {
  const [lines, setLines] = useState<StreamLine[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const seqRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const modeKeyValue = modeKey(mode);

  const push = useCallback((line: StreamLine) => {
    setLines((prev) => [...prev, line]);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLines([]);
    setIsLive(false);
    setExitCode(null);
    seqRef.current = 0;
    esRef.current?.close();
    if (pollRef.current) clearInterval(pollRef.current);

    if (mode.type === "idle") return;

    if (mode.type === "run") {
      const es = new EventSource(mode.url);
      esRef.current = es;
      setIsLive(true);

      es.onmessage = (e) => {
        const data = JSON.parse(e.data as string) as {
          type: string;
          text?: string;
          stream?: "stdout" | "stderr";
          code?: number;
          message?: string;
        };
        if (data.type === "line" && data.text) {
          push({
            id: `run-${Date.now()}-${Math.random()}`,
            text: data.text,
            isStderr: data.stream === "stderr",
          });
        } else if (data.type === "exit") {
          setExitCode(data.code ?? 0);
          setIsLive(false);
          es.close();
        } else if (data.type === "error") {
          push({ id: `err-${Date.now()}`, text: data.message ?? "error", isStderr: true });
          setIsLive(false);
          es.close();
        }
      };

      es.onerror = () => {
        setIsLive(false);
        es.close();
      };

      return () => {
        es.close();
        setIsLive(false);
      };
    }

    if (mode.type === "pi") {
      const url = `/api/agent/${encodeURIComponent(mode.sessionId)}/events`;
      const es = new EventSource(url);
      esRef.current = es;
      setIsLive(true);

      es.onmessage = (e) => {
        const event = JSON.parse(e.data as string) as { type: string; [k: string]: unknown };
        let text: string | null = null;

        if (event.type === "text_delta" && typeof event.delta === "string") {
          text = event.delta;
        } else if (event.type === "agent_end") {
          setIsLive(false);
          es.close();
          return;
        } else if (event.type === "connected") {
          return;
        } else {
          text = event.type;
        }

        if (text) {
          push({ id: `pi-${Date.now()}-${Math.random()}`, text });
        }
      };

      es.onerror = () => {
        setIsLive(false);
        es.close();
      };

      return () => {
        es.close();
        setIsLive(false);
      };
    }

    if (mode.type === "poll") {
      setIsLive(true);

      const fetchEvents = async () => {
        try {
          const res = await fetch(mode.eventsUrl);
          if (!res.ok) return;
          const { events } = (await res.json()) as { events: NorthstarRunEvent[] };
          const newEvents = events.filter((e) => e.sequence > seqRef.current);
          if (newEvents.length > 0) {
            seqRef.current = Math.max(...newEvents.map((e) => e.sequence));
            for (const e of newEvents) {
              push({
                id: e.id,
                text: e.summary,
                severity: e.severity,
                timestamp: e.createdAt ?? undefined,
              });
            }
          }
        } catch {
          // swallow — poll will retry
        }
      };

      void fetchEvents();
      pollRef.current = setInterval(() => void fetchEvents(), 2000);

      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
        setIsLive(false);
      };
    }
  // Use modeKeyValue (string) instead of mode (object) to avoid infinite-loop
  // from object-identity changes on each render.
  }, [modeKeyValue, push]); // eslint-disable-line react-hooks/exhaustive-deps

  return { lines, isLive, exitCode };
}
