"use client";

import type { NorthstarBoardCard } from "@/lib/northstar/types";

import { usePiSessionSse } from "./usePiSessionSse";

interface Props {
  card: NorthstarBoardCard | null;
  onClose: () => void;
}

export function IssueSseModal({ card, onClose }: Props) {
  const sessionId = card?.latestRootSessionId ?? null;
  const { lines, isLive, isReconnecting, reconnectAttempts, reconnectNow, clear } = usePiSessionSse(sessionId);

  if (!card) return null;

  const issueLabel = card.issueNumber ? `#${card.issueNumber}` : card.issueId;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.38)", zIndex: 120, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}
    >
      <section style={{ width: "min(920px, 96vw)", height: "min(70vh, 700px)", border: "1px solid var(--border)", borderRadius: 8, background: "var(--bg)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {issueLabel} SSE Stream
            </div>
            <div style={{ fontSize: 11, color: isLive ? "#16a34a" : isReconnecting ? "#d97706" : "var(--text-muted)" }}>
              {isLive ? "live" : isReconnecting ? `reconnecting (${reconnectAttempts})` : "stopped"}
              {sessionId ? ` · ${sessionId}` : ""}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {reconnectAttempts >= 5 && <button type="button" onClick={reconnectNow} style={btnStyle}>Reconnect</button>}
            <button type="button" onClick={clear} style={btnStyle}>Clear</button>
            <button type="button" onClick={onClose} style={btnStyle}>Close</button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "10px 12px", fontFamily: "var(--font-mono)", fontSize: 11, display: "flex", flexDirection: "column", gap: 2 }}>
          {!sessionId ? (
            <div style={{ color: "var(--text-dim)" }}>No root session id for this issue yet.</div>
          ) : lines.length === 0 ? (
            <div style={{ color: "var(--text-dim)" }}>{isLive ? "Waiting for stream..." : "No events yet."}</div>
          ) : (
            lines.map((line) => (
              <div key={line.id} style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", color: line.tone === "error" ? "#ef4444" : line.tone === "warning" ? "#d97706" : "var(--text-muted)" }}>
                {line.text}
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "4px 10px",
  fontSize: 11,
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg-panel)",
  color: "var(--text)",
  cursor: "pointer",
};
