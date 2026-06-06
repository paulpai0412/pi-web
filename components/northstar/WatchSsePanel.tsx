"use client";

import { useCallback, useEffect, useMemo, type MouseEvent as ReactMouseEvent } from "react";

import type { AgentMessage, ToolResultMessage } from "@/lib/types";

import { MessageView } from "@/components/MessageView";

import { usePiSessionSse } from "./usePiSessionSse";

interface Props {
  sessionId: string | null;
  title?: string;
  height: number;
  onHeightChange: (nextHeight: number) => void;
  onClose?: () => void;
  onSessionEnded?: () => void;
  embedded?: boolean;
}

function buildToolResultsMap(messages: AgentMessage[]): Map<string, ToolResultMessage> {
  const map = new Map<string, ToolResultMessage>();
  for (const msg of messages) {
    if (msg.role === "toolResult") {
      map.set((msg as ToolResultMessage).toolCallId, msg as ToolResultMessage);
    }
  }
  return map;
}

export function WatchSsePanel({
  sessionId,
  title = "Northstar Watch SSE",
  height,
  onHeightChange,
  onClose,
  onSessionEnded,
  embedded = false,
}: Props) {
  const { messages, streamingMessage, isLive, isReconnecting, reconnectAttempts, reconnectNow, clear, ended } = usePiSessionSse(sessionId);

  const visibleMessages = useMemo(() => {
    const base = messages.filter((m) => m.role === "user" || m.role === "assistant");
    if (streamingMessage) base.push(streamingMessage);
    return base;
  }, [messages, streamingMessage]);

  const toolResultsMap = useMemo(() => buildToolResultsMap(messages), [messages]);

  useEffect(() => {
    if (ended) onSessionEnded?.();
  }, [ended, onSessionEnded]);

  const startResize = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;

    const onMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const next = Math.max(140, Math.min(560, Math.round(startHeight + delta)));
      onHeightChange(next);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [height, onHeightChange]);

  return (
    <section style={{ borderTop: embedded ? "none" : "1px solid var(--border)", background: "var(--bg)", height: embedded ? "100%" : height, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {!embedded && (
        <div
          onMouseDown={startResize}
          title="Drag to resize"
          style={{ height: 8, cursor: "row-resize", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0, transition: "background 140ms ease" }}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>{title}</span>
          <span style={{ fontSize: 11, color: isLive ? "#16a34a" : isReconnecting ? "#d97706" : "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px", background: "var(--bg-panel)" }}>
            {isLive ? "live" : isReconnecting ? `reconnecting (${reconnectAttempts})` : "stopped"}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px", background: "var(--bg-panel)" }}>
            msgs: {visibleMessages.length}
          </span>
          {sessionId && <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>session: {sessionId}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {reconnectAttempts >= 5 && (
            <button className="ns-btn" type="button" onClick={reconnectNow} style={btnStyle}>Reconnect</button>
          )}
          <button className="ns-btn" type="button" onClick={clear} style={btnStyle}>Clear</button>
          {onClose && <button className="ns-btn" type="button" onClick={onClose} style={btnStyle}>Close</button>}
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px" }}>
        {!sessionId ? (
          <div style={{ color: "var(--text-dim)", fontSize: 12 }}>No active watch session.</div>
        ) : visibleMessages.length === 0 ? (
          <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{isLive ? "Waiting for stream..." : "No events yet."}</div>
        ) : (
          visibleMessages.map((msg, i) => (
            <MessageView
              key={`${msg.role}-${i}-${msg.timestamp ?? 0}`}
              message={msg}
              isStreaming={!!streamingMessage && i === visibleMessages.length - 1 && msg.role === "assistant"}
              toolResults={toolResultsMap}
              showTimestamp={false}
            />
          ))
        )}
      </div>
    </section>
  );
}

const btnStyle: React.CSSProperties = {
  height: 26,
  padding: "0 10px",
  fontSize: 11,
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg-panel)",
  color: "var(--text)",
  cursor: "pointer",
  transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
};
