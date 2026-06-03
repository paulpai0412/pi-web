"use client";

import { useCallback, useEffect, type MouseEvent as ReactMouseEvent } from "react";

import { usePiSessionSse } from "./usePiSessionSse";

interface Props {
  sessionId: string | null;
  title?: string;
  height: number;
  onHeightChange: (nextHeight: number) => void;
  onClose: () => void;
  onSessionEnded?: () => void;
}

export function WatchSsePanel({
  sessionId,
  title = "Northstar Watch SSE",
  height,
  onHeightChange,
  onClose,
  onSessionEnded,
}: Props) {
  const { lines, isLive, isReconnecting, reconnectAttempts, reconnectNow, clear, ended } = usePiSessionSse(sessionId);

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
    <section style={{ borderTop: "1px solid var(--border)", background: "var(--bg)", height, display: "flex", flexDirection: "column", minHeight: 0 }}>
      <div
        onMouseDown={startResize}
        title="Drag to resize"
        style={{ height: 8, cursor: "row-resize", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0, transition: "background 140ms ease" }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", whiteSpace: "nowrap" }}>{title}</span>
          <span style={{ fontSize: 11, color: isLive ? "#16a34a" : isReconnecting ? "#d97706" : "var(--text-muted)" }}>
            {isLive ? "live" : isReconnecting ? `reconnecting (${reconnectAttempts})` : "stopped"}
          </span>
          {sessionId && <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>session: {sessionId}</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {reconnectAttempts >= 5 && (
            <button className="ns-btn" type="button" onClick={reconnectNow} style={btnStyle}>Reconnect</button>
          )}
          <button className="ns-btn" type="button" onClick={clear} style={btnStyle}>Clear</button>
          <button className="ns-btn" type="button" onClick={onClose} style={btnStyle}>Close</button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 11, display: "flex", flexDirection: "column", gap: 2 }}>
        {!sessionId ? (
          <div style={{ color: "var(--text-dim)" }}>No active watch session.</div>
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
