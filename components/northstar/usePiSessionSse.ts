"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface PiSessionEntry {
  id: string;
  role: "assistant" | "tool" | "system";
  text: string;
  isLive?: boolean;
}

type AgentEvent = {
  type: string;
  delta?: string;
  message?: unknown;
  toolName?: string;
  errorMessage?: string;
  messageText?: string;
};

function textFromMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as { type?: string; text?: string; summary?: string };
    if (typeof b.text === "string") parts.push(b.text);
    else if (typeof b.summary === "string") parts.push(b.summary);
    else if (typeof b.type === "string") parts.push(`[${b.type}]`);
  }
  return parts.join("\n");
}

function summarizeToolResult(content: unknown): string {
  const text = textFromMessageContent(content);
  return text || "Tool result";
}

export function usePiSessionSse(sessionId: string | null) {
  const [entries, setEntries] = useState<PiSessionEntry[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRef = useRef(false);
  const currentAssistantIdRef = useRef<string | null>(null);

  const pushEntry = useCallback((entry: PiSessionEntry) => {
    setEntries((prev) => [...prev, entry]);
  }, []);

  const updateEntryText = useCallback((id: string, updater: (prev: string) => string, isLive?: boolean) => {
    setEntries((prev) => prev.map((entry) => {
      if (entry.id !== id) return entry;
      return {
        ...entry,
        text: updater(entry.text),
        ...(isLive !== undefined ? { isLive } : {}),
      };
    }));
  }, []);

  const clear = useCallback(() => {
    currentAssistantIdRef.current = null;
    setEntries([]);
  }, []);

  const reconnectNow = useCallback(() => {
    setReconnectAttempts(0);
    setReconnectNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    esRef.current?.close();
    if (timerRef.current) clearTimeout(timerRef.current);

    currentAssistantIdRef.current = null;
    setEntries([]);
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

        const event = JSON.parse(e.data as string) as AgentEvent;

        if (event.type === "connected") return;

        if (event.type === "agent_start") {
          pushEntry({ id: `sys-${Date.now()}-${Math.random()}`, role: "system", text: "Agent started" });
          return;
        }

        if (event.type === "text_delta" && typeof event.delta === "string") {
          let assistantId = currentAssistantIdRef.current;
          if (!assistantId) {
            assistantId = `assistant-${Date.now()}-${Math.random()}`;
            currentAssistantIdRef.current = assistantId;
            pushEntry({ id: assistantId, role: "assistant", text: event.delta, isLive: true });
            return;
          }
          updateEntryText(assistantId, (prev) => prev + event.delta, true);
          return;
        }

        if (event.type === "message_end" && event.message && typeof event.message === "object") {
          const msg = event.message as { role?: string; content?: unknown };
          if (msg.role === "assistant") {
            const finalText = textFromMessageContent(msg.content);
            const assistantId = currentAssistantIdRef.current;
            if (assistantId) {
              if (finalText) {
                updateEntryText(assistantId, () => finalText, false);
              } else {
                updateEntryText(assistantId, (prev) => prev, false);
              }
            } else {
              pushEntry({ id: `assistant-${Date.now()}-${Math.random()}`, role: "assistant", text: finalText || "(no content)", isLive: false });
            }
            currentAssistantIdRef.current = null;
            return;
          }

          if (msg.role === "toolResult") {
            pushEntry({ id: `tool-${Date.now()}-${Math.random()}`, role: "tool", text: summarizeToolResult(msg.content) });
            return;
          }

          if (msg.role === "user") {
            const text = textFromMessageContent(msg.content);
            if (text) pushEntry({ id: `usr-${Date.now()}-${Math.random()}`, role: "system", text: `User: ${text}` });
            return;
          }
        }

        if (event.type === "tool_execution_start") {
          pushEntry({ id: `tool-start-${Date.now()}-${Math.random()}`, role: "system", text: `Running tool: ${event.toolName ?? "unknown"}` });
          return;
        }

        if (event.type === "tool_execution_end") {
          pushEntry({ id: `tool-end-${Date.now()}-${Math.random()}`, role: "system", text: `Tool finished: ${event.toolName ?? "unknown"}` });
          return;
        }

        if (event.type === "agent_end") {
          stopRef.current = true;
          setEnded(true);
          setIsLive(false);
          setIsReconnecting(false);
          currentAssistantIdRef.current = null;
          pushEntry({ id: `sys-end-${Date.now()}-${Math.random()}`, role: "system", text: "Agent finished" });
          es.close();
          return;
        }

        if (event.type === "error" || event.type === "agent_error") {
          pushEntry({
            id: `err-${Date.now()}-${Math.random()}`,
            role: "system",
            text: event.errorMessage ?? event.messageText ?? "Agent error",
          });
          return;
        }
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
      currentAssistantIdRef.current = null;
      setIsLive(false);
      setIsReconnecting(false);
    };
  }, [pushEntry, reconnectNonce, sessionId, updateEntryText]);

  return {
    entries,
    isLive,
    isReconnecting,
    reconnectAttempts,
    error,
    ended,
    reconnectNow,
    clear,
  };
}
