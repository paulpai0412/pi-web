"use client";

import { useMemo } from "react";

import { MessageView } from "@/components/MessageView";
import type { NorthstarBoardCard } from "@/lib/northstar/types";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";

import { usePiSessionSse } from "./usePiSessionSse";
import { useIssueStream } from "./useIssueStream";

interface Props {
  card: NorthstarBoardCard | null;
  projectId: string;
  configPath: string;
  onClose: () => void;
}

function sessionStreamAdapter(adapter: NorthstarBoardCard["latestHostAdapter"]): "pi" | "codex" | "opencode" | null {
  if (adapter === "pi" || adapter === "codex" || adapter === "opencode") return adapter;
  return null;
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

export function IssueSseModal({ card, projectId, configPath, onClose }: Props) {
  const sessionId = card?.activeStreamSessionId ?? card?.latestRootSessionId ?? null;
  const streamAdapter = sessionStreamAdapter(card?.activeStreamAdapter ?? card?.latestHostAdapter ?? null);
  const useSessionStream = !!streamAdapter && !!sessionId;
  const {
    messages,
    streamingMessage,
    isLive: piLive,
    isReconnecting,
    reconnectAttempts,
    reconnectNow,
    clear,
    error: piError,
  } = usePiSessionSse(useSessionStream ? sessionId : null, streamAdapter ?? "pi");
  const eventsUrl = card
    ? `/api/northstar/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(card.issueId)}/events?config=${encodeURIComponent(configPath)}`
    : "";
  const { lines, isLive: pollLive } = useIssueStream(
    card && !useSessionStream ? { type: "poll", eventsUrl } : { type: "idle" },
  );

  const visibleMessages = useMemo(() => {
    const base = messages.filter((m) => m.role === "user" || m.role === "assistant");
    if (streamingMessage) base.push(streamingMessage);
    return base;
  }, [messages, streamingMessage]);

  const toolResultsMap = useMemo(() => buildToolResultsMap(messages), [messages]);

  if (!card) return null;

  const issueLabel = card.issueNumber ? `#${card.issueNumber}` : card.issueId;
  const live = useSessionStream ? piLive : pollLive;
  const reconnecting = useSessionStream ? isReconnecting : false;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.38)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <section style={{ width: "min(920px, 96vw)", height: "min(70vh, 700px)", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 12px 32px rgba(0,0,0,0.22)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {issueLabel} SSE Stream
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2, minWidth: 0 }}>
              <span style={{ ...badgeStyle, color: live ? "#16a34a" : reconnecting ? "#d97706" : "var(--text-muted)" }}>
                {live ? "live" : reconnecting ? `reconnecting (${reconnectAttempts})` : "stopped"}
              </span>
              <span style={{ ...badgeStyle, minWidth: 118 }}>
                {useSessionStream ? `stream: ${streamAdapter} session` : "stream: issue events"}
              </span>
              <span style={{ ...badgeStyle, minWidth: 68 }}>
                msgs: {useSessionStream ? visibleMessages.length : lines.length}
              </span>
              {useSessionStream && sessionId ? <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 140, maxWidth: 230 }}>{sessionId}</span> : null}
              {card.activeStreamChildRunId ? <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>child: {card.activeStreamChildRunId}</span> : null}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {useSessionStream && reconnectAttempts >= 5 && <button className="ns-btn" type="button" onClick={reconnectNow} style={btnStyle}>Reconnect</button>}
            {useSessionStream && <button className="ns-btn" type="button" onClick={clear} style={btnStyle}>Clear</button>}
            <button className="ns-btn" type="button" onClick={onClose} style={btnStyle}>Close</button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px" }}>
          {useSessionStream ? (
            !sessionId ? (
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>No root session id for this issue yet.</div>
            ) : visibleMessages.length === 0 ? (
              <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{live ? "Waiting for stream..." : "No events yet."}</div>
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
            )
          ) : lines.length === 0 ? (
            <div style={{ color: "var(--text-dim)", fontSize: 12 }}>{live ? "Waiting for issue events..." : "No issue events yet."}</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {lines.map((line) => (
                <div
                  key={line.id}
                  style={{
                    fontSize: 11,
                    fontFamily: "var(--font-mono)",
                    color:
                      line.severity === "error"
                        ? "#ef4444"
                        : line.severity === "warning"
                          ? "#d97706"
                          : "var(--text-muted)",
                  }}
                >
                  {line.timestamp ? `${line.timestamp.slice(11, 19)} ` : ""}
                  {line.text}
                </div>
              ))}
            </div>
          )}
          {useSessionStream && piError && (
            <div style={{ color: "#ef4444", fontSize: 11, marginTop: 8 }}>{piError}</div>
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

const badgeStyle: React.CSSProperties = {
  flexShrink: 0,
  fontSize: 11,
  color: "var(--text-dim)",
  border: "1px solid var(--border)",
  borderRadius: 999,
  padding: "1px 8px",
  background: "var(--bg-panel)",
  whiteSpace: "nowrap",
  textAlign: "center",
};
