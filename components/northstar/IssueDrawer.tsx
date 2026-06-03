"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  NorthstarBoardCard,
  NorthstarIssueDetail,
} from "@/lib/northstar/types";

interface Action {
  label: string;
  command: string;
}

function actionsForCard(card: NorthstarBoardCard): Action[] {
  const actions: Action[] = [];
  const lc = card.lifecycle;
  if (lc === "ready") actions.push({ label: "▶ Start", command: "start" });
  else if (lc === "claimed" || lc === "running" || lc === "verifying")
    actions.push({ label: "Reconcile", command: "reconcile" });
  else if (lc === "verified") actions.push({ label: "🚀 Release", command: "release" });
  else if (lc === "release_pending") actions.push({ label: "Reconcile", command: "reconcile" });
  else if (lc === "failed") actions.push({ label: "Reconcile", command: "reconcile" });
  else if (lc === "quarantined") actions.push({ label: "Repair runtime", command: "repair-runtime" });
  if (card.blocked || card.projectionFailure)
    actions.push({ label: "Retry sync", command: "retry-sync" });
  return actions;
}

interface Props {
  card: NorthstarBoardCard | null;
  projectId: string;
  configPath: string;
  onClose: () => void;
}

const drawerStyle: React.CSSProperties = {
  position: "fixed",
  top: 0,
  right: 0,
  height: "100%",
  width: 420,
  background: "var(--bg)",
  borderLeft: "1px solid var(--border)",
  display: "flex",
  flexDirection: "column",
  zIndex: 100,
  boxShadow: "-4px 0 16px rgba(0,0,0,0.15)",
  overflow: "hidden",
};

const sectionStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--border)",
  padding: "8px 14px",
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  color: "var(--text-muted)",
  marginBottom: 6,
  textTransform: "uppercase",
  letterSpacing: 1,
};

const btnStyle: React.CSSProperties = {
  height: 26,
  padding: "0 12px",
  fontSize: 12,
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg-panel)",
  color: "var(--text)",
  cursor: "pointer",
  marginRight: 6,
  transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
};

export function IssueDrawer({ card, projectId, configPath, onClose }: Props) {
  const [detail, setDetail] = useState<NorthstarIssueDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [isRunningAction, setIsRunningAction] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!card) {
      setDetail(null);
      setDetailError(null);
      setActionStatus(null);
      return;
    }
    setDetail(null);
    setDetailError(null);
    setActionStatus(null);

    const url = `/api/northstar/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(card.issueId)}?config=${encodeURIComponent(configPath)}`;
    fetch(url)
      .then((r) => r.json())
      .then((body: { issue?: NorthstarIssueDetail; error?: string }) => {
        if (body.error) setDetailError(body.error);
        else if (body.issue) setDetail(body.issue);
      })
      .catch((e: unknown) => setDetailError(String(e)));
  }, [card, projectId, configPath]);

  const runAction = useCallback(
    (command: string) => {
      if (!card || isRunningAction) return;
      const url = `/api/northstar/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(card.issueId)}/run?action=${encodeURIComponent(command)}&config=${encodeURIComponent(configPath)}`;

      setIsRunningAction(true);
      setActionStatus(`Running ${command}...`);

      const es = new EventSource(url);

      es.onmessage = (e) => {
        const data = JSON.parse(e.data as string) as { type: string; code?: number; message?: string };
        if (data.type === "exit") {
          setActionStatus(data.code === 0 ? `${command} completed.` : `${command} failed (exit ${data.code ?? 1}).`);
          setIsRunningAction(false);
          es.close();
        } else if (data.type === "error") {
          setActionStatus(data.message ?? `${command} failed.`);
          setIsRunningAction(false);
          es.close();
        }
      };

      es.onerror = () => {
        setActionStatus(`${command} interrupted.`);
        setIsRunningAction(false);
        es.close();
      };
    },
    [card, configPath, isRunningAction, projectId]
  );

  if (!card) return null;

  const actions = actionsForCard(card);
  const issueLabel = card.issueNumber ? `#${card.issueNumber}` : card.issueId;

  return (
    <div style={drawerStyle}>
      <div style={{ ...sectionStyle, display: "flex", alignItems: "flex-start", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text)" }}>
            {issueLabel} — {card.lifecycle.replace(/_/g, " ")}
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {card.title}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>
            {card.currentStage ? `stage: ${card.currentStage}` : "no stage"}
            {card.latestHostAdapter ? ` · host: ${card.latestHostAdapter}` : ""}
            {` · deps: ${card.dependencyCount}`}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
            {detail?.sourceUrl && (
              <a href={detail.sourceUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--accent)" }}>
                GitHub issue ↗
              </a>
            )}
            {card.prUrl && (
              <a href={card.prUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--accent)" }}>
                View PR ↗
              </a>
            )}
          </div>
        </div>
        <button type="button" onClick={onClose} style={{ ...btnStyle, width: 28, padding: 0, flexShrink: 0, marginRight: 0 }} aria-label="Close issue drawer" title="Close">
          ✕
        </button>
      </div>

      {actions.length > 0 && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Actions</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {actions.map((action) => (
              <button
                key={action.command}
                type="button"
                onClick={() => runAction(action.command)}
                disabled={isRunningAction}
                style={{ ...btnStyle, opacity: isRunningAction ? 0.5 : 1 }}
              >
                {action.label}
              </button>
            ))}
          </div>
          {card.lifecycle === "quarantined" && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>
              Recovery: {card.nextRecommendedAction}
            </div>
          )}
          {actionStatus && (
            <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 6 }}>{actionStatus}</div>
          )}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={sectionStyle}>
          <button
            type="button"
            onClick={() => setSnapshotOpen((v) => !v)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, padding: 0, transition: "color 140ms ease" }}
          >
            {snapshotOpen ? "▾" : "▸"} Snapshot
          </button>
          {snapshotOpen && (
            <pre style={{ fontSize: 10, fontFamily: "var(--font-mono)", color: "var(--text-muted)", marginTop: 6, overflow: "auto", maxHeight: 240, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
              {detailError
                ? `Error: ${detailError}`
                : detail
                ? JSON.stringify(detail.snapshot, null, 2)
                : "Loading…"}
            </pre>
          )}
        </div>

        <div style={sectionStyle}>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, padding: 0, transition: "color 140ms ease" }}
          >
            {historyOpen ? "▾" : "▸"} History {detail ? `(${detail.timeline.length})` : ""}
          </button>
          {historyOpen && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
              {!detail && !detailError && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Loading…</div>}
              {detailError && <div style={{ fontSize: 11, color: "#ef4444" }}>{detailError}</div>}
              {detail?.timeline.map((event) => (
                <div key={event.id} style={{ fontSize: 11, fontFamily: "var(--font-mono)", display: "flex", gap: 8, color: event.severity === "error" ? "#ef4444" : event.severity === "warning" ? "#d97706" : "var(--text-muted)" }}>
                  <span style={{ flexShrink: 0, opacity: 0.6 }}>{event.createdAt ? event.createdAt.slice(11, 19) : "—"}</span>
                  <span>{event.summary}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
