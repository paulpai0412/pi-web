"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { normalizeToolCalls } from "@/lib/normalize";
import type { AgentMessage, AssistantMessage, TextContent } from "@/lib/types";

type AgentEvent = {
  type: string;
  message?: AgentMessage;
  delta?: string;
  errorMessage?: string;
};

function createStreamingAssistantWithDelta(delta: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: delta }],
    model: "",
    provider: "",
    timestamp: Date.now(),
  };
}

function appendDeltaToAssistant(msg: AssistantMessage, delta: string): AssistantMessage {
  const content = Array.isArray(msg.content) ? [...msg.content] : [];
  const last = content[content.length - 1];

  if (last && last.type === "text") {
    const updatedLast: TextContent = { ...last, text: `${last.text}${delta}` };
    content[content.length - 1] = updatedLast;
  } else {
    content.push({ type: "text", text: delta });
  }

  return { ...msg, content };
}

export function usePiSessionSse(sessionId: string | null) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [streamingMessage, setStreamingMessage] = useState<AssistantMessage | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const esRef = useRef<EventSource | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopRef = useRef(false);

  const clear = useCallback(() => {
    setMessages([]);
    setStreamingMessage(null);
  }, []);

  const reconnectNow = useCallback(() => {
    setReconnectAttempts(0);
    setReconnectNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    esRef.current?.close();
    if (timerRef.current) clearTimeout(timerRef.current);

    setMessages([]);
    setStreamingMessage(null);
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

        if ((event.type === "message_start" || event.type === "message_update") && event.message) {
          const msg = normalizeToolCalls(event.message);
          if (msg.role === "assistant") {
            setStreamingMessage(msg as AssistantMessage);
          }
          return;
        }

        if (event.type === "text_delta" && typeof event.delta === "string") {
          setStreamingMessage((prev) => {
            if (!prev) return createStreamingAssistantWithDelta(event.delta as string);
            return appendDeltaToAssistant(prev, event.delta as string);
          });
          return;
        }

        if (event.type === "message_end" && event.message) {
          const completed = normalizeToolCalls(event.message);
          setMessages((prev) => [...prev, completed]);
          if (completed.role === "assistant") setStreamingMessage(null);
          return;
        }

        if (event.type === "agent_end") {
          stopRef.current = true;
          setEnded(true);
          setIsLive(false);
          setIsReconnecting(false);
          setStreamingMessage(null);
          es.close();
          return;
        }

        if (event.type === "error" || event.type === "agent_error") {
          setError(event.errorMessage ?? "Agent error");
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
      setIsLive(false);
      setIsReconnecting(false);
    };
  }, [reconnectNonce, sessionId]);

  return {
    messages,
    streamingMessage,
    isLive,
    isReconnecting,
    reconnectAttempts,
    error,
    ended,
    reconnectNow,
    clear,
  };
}
