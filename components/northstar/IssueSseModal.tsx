"use client";

import { useMemo } from "react";

import { MessageView } from "@/components/MessageView";
import type { NorthstarBoardCard } from "@/lib/northstar/types";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";

import { usePiSessionSse } from "./usePiSessionSse";

interface Props {
  card: NorthstarBoardCard | null;
  onClose: () => void;
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

export function IssueSseModal({ card, onClose }: Props) {
  const sessionId = card?.latestRootSessionId ?? null;
  const { messages, streamingMessage, isLive, isReconnecting, reconnectAttempts, reconnectNow, clear } = usePiSessionSse(sessionId);

  const visibleMessages = useMemo(() => {
    const base = messages.filter((m) => m.role === "user" || m.role === "assistant");
    if (streamingMessage) base.push(streamingMessage);
    return base;
  }, [messages, streamingMessage]);

  const toolResultsMap = useMemo(() => buildToolResultsMap(messages), [messages]);

  if (!card) return null;

  const issueLabel = card.issueNumber ? `#${card.issueNumber}` : card.issueId;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.38)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <section style={{ width: "min(920px, 96vw)", height: "min(70vh, 700px)", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {issueLabel} SSE Stream
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
              <span style={{ fontSize: 11, color: isLive ? "#16a34a" : isReconnecting ? "#d97706" : "var(--text-muted)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px", background: "var(--bg-panel)" }}>
                {isLive ? "live" : isReconnecting ? `reconnecting (${reconnectAttempts})` : "stopped"}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-dim)", border: "1px solid var(--border)", borderRadius: 999, padding: "1px 8px", background: "var(--bg-panel)" }}>
                msgs: {visibleMessages.length}
              </span>
              {sessionId ? <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sessionId}</span> : null}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {reconnectAttempts >= 5 && <button className="ns-btn" type="button" onClick={reconnectNow} style={btnStyle}>Reconnect</button>}
            <button className="ns-btn" type="button" onClick={clear} style={btnStyle}>Clear</button>
            <button className="ns-btn" type="button" onClick={onClose} style={btnStyle}>Close</button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {!sessionId ? (
            <div style={{ color: "var(--text-dim)", fontSize: 12 }}>No root session id for this issue yet.</div>
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
    </div>
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
