"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  NorthstarBoardCard,
  NorthstarIssueDetail,
  NorthstarRunEvent,
} from "@/lib/northstar/types";

interface Action {
  label: string;
  command: "start" | "reconcile" | "release" | "repair-runtime" | "retry-sync" | "resume";
  targetLifecycle?: "ready" | "running";
}

function actionsForCard(card: NorthstarBoardCard): Action[] {
  const actions: Action[] = [];
  const lc = card.lifecycle;
  if (lc === "ready") actions.push({ label: "▶ Start", command: "start" });
  else if (lc === "claimed" || lc === "running" || lc === "verifying")
    actions.push({ label: "Reconcile", command: "reconcile" });
  else if (lc === "verified") actions.push({ label: "🚀 Release", command: "release" });
  else if (lc === "release_pending") actions.push({ label: "Approve Release", command: "release" });
  else if (lc === "releasing") actions.push({ label: "Reconcile", command: "reconcile" });
  else if (lc === "exception") actions.push({ label: "Reconcile", command: "reconcile" });
  else if (lc === "failed") actions.push({ label: "Reconcile", command: "reconcile" });
  else if (lc === "quarantined") {
    actions.push({ label: "Repair runtime", command: "repair-runtime" });
    actions.push({ label: "Resume", command: "resume", targetLifecycle: "ready" });
  }
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
  zIndex: 1200,
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

type HistoryTone = "start" | "success" | "warning" | "error" | "transition" | "neutral";

interface ExceptionInfo {
  summary: string | null;
  details: Array<{ label: string; value: string }>;
}

const historyToneStyle: Record<HistoryTone, { border: string; bg: string; text: string; pill: string }> = {
  start: { border: "#2563eb", bg: "#2563eb14", text: "#60a5fa", pill: "#2563eb22" },
  success: { border: "#16a34a", bg: "#16a34a14", text: "#22c55e", pill: "#16a34a22" },
  warning: { border: "#d97706", bg: "#d9770618", text: "#f59e0b", pill: "#d9770626" },
  error: { border: "#ef4444", bg: "#ef444418", text: "#ef4444", pill: "#ef444426" },
  transition: { border: "#7c3aed", bg: "#7c3aed14", text: "#a78bfa", pill: "#7c3aed22" },
  neutral: { border: "var(--border)", bg: "var(--bg-panel)", text: "var(--text-muted)", pill: "var(--bg-hover)" },
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringValue(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function booleanValue(value: unknown): string | null {
  return typeof value === "boolean" ? String(value) : null;
}

function eventPayload(event: NorthstarRunEvent): Record<string, unknown> | null {
  return objectValue(event.payloadPreview);
}

function compactValue(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function runtimeContext(detail: NorthstarIssueDetail | null): Record<string, unknown> | null {
  return objectValue(objectValue(detail?.snapshot)?.runtime_context_json);
}

function buildExceptionInfo(card: NorthstarBoardCard, detail: NorthstarIssueDetail | null): ExceptionInfo | null {
  if (!detail) return null;

  const runtime = runtimeContext(detail);
  const inspect = objectValue(detail.inspect);
  const exception = objectValue(runtime?.exception) ?? objectValue(runtime?.exception_carry_forward);
  const latestProblem = [...detail.timeline].reverse().find((event) => (
    event.severity !== "info" || /exception|quarantine|failed|blocked|stale|violation/i.test(event.eventType)
  ));
  const latestPayload = latestProblem ? eventPayload(latestProblem) : null;
  const summary = stringValue(
    exception?.summary ??
    exception?.reason ??
    exception?.message ??
    runtime?.last_error ??
    inspect?.last_error ??
    latestPayload?.last_error ??
    latestPayload?.reason ??
    latestProblem?.summary ??
    card.nextRecommendedAction
  );

  const details: Array<{ label: string; value: string }> = [];
  const add = (label: string, value: unknown) => {
    const compact = compactValue(value);
    if (compact) details.push({ label, value: compact });
  };

  add("category", exception?.category ?? latestPayload?.category);
  add("severity", exception?.severity ?? latestPayload?.severity);
  add("source", exception?.source_stage ?? exception?.source_lifecycle ?? latestPayload?.source_stage);
  add("role", exception?.source_role ?? latestPayload?.role);
  add("child", exception?.source_child_run_id ?? latestPayload?.child_run_id);
  add("retryable", booleanValue(exception?.retryable) ?? latestPayload?.retryable);
  add("attempts", exception?.attempt_count);
  add("created", exception?.created_at ?? latestProblem?.createdAt);
  add("recommended", exception?.recommended_action ?? card.nextRecommendedAction);

  return { summary, details };
}

function historyTone(event: NorthstarRunEvent): HistoryTone {
  const eventType = event.eventType.toLowerCase();
  const payload = eventPayload(event);
  const status = stringValue(payload?.status)?.toLowerCase() ?? "";

  if (event.severity === "error" || /failed|failure|quarantine|violation|exception/.test(eventType) || /failed|error|blocked/.test(status)) {
    return "error";
  }
  if (event.severity === "warning" || /retry|blocked|stale/.test(eventType) || /retry|warning|stale/.test(status)) {
    return "warning";
  }
  if (/started|start|queued|lease_acquired|claimed|created/.test(eventType) || status === "running" || status === "queued") {
    return "start";
  }
  if (/completed|succeeded|success|artifact_received|released|resolved|merged|approved/.test(eventType) || /succeeded|success|pass|completed/.test(status)) {
    return "success";
  }
  if (/synced|transition|stage|lifecycle|approval|resume|reconcile|result/.test(eventType)) {
    return "transition";
  }
  return "neutral";
}

function historyStageLabel(event: NorthstarRunEvent): string {
  const payload = eventPayload(event);
  const label = stringValue(
    payload?.stage ??
    payload?.current_stage ??
    payload?.target_stage ??
    payload?.source_stage ??
    payload?.role ??
    payload?.lifecycle ??
    payload?.lifecycle_state ??
    payload?.to_lifecycle ??
    payload?.status
  );
  if (label) return label.replace(/_/g, " ");
  return event.eventType.replace(/_/g, " ");
}

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
    (action: Action) => {
      if (!card || isRunningAction) return;

      const params = new URLSearchParams({
        action: action.command,
        config: configPath,
      });

      if (action.command === "resume") {
        params.set("to", action.targetLifecycle ?? "ready");
        const reasonRaw = window.prompt("Resume reason (required)", "runtime fix deployed");
        if (reasonRaw === null) return;
        const reason = reasonRaw.trim();
        if (!reason) {
          setActionStatus("Resume reason is required.");
          return;
        }
        params.set("reason", reason);
      }

      const url = `/api/northstar/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(card.issueId)}/run?${params.toString()}`;

      setIsRunningAction(true);
      setActionStatus(`Running ${action.label}...`);

      const es = new EventSource(url);

      es.onmessage = (e) => {
        const data = JSON.parse(e.data as string) as { type: string; code?: number; message?: string };
        if (data.type === "exit") {
          setActionStatus(data.code === 0 ? `${action.label} completed.` : `${action.label} failed (exit ${data.code ?? 1}).`);
          setIsRunningAction(false);
          es.close();
        } else if (data.type === "error") {
          setActionStatus(data.message ?? `${action.label} failed.`);
          setIsRunningAction(false);
          es.close();
        }
      };

      es.onerror = () => {
        setActionStatus(`${action.label} interrupted.`);
        setIsRunningAction(false);
        es.close();
      };
    },
    [card, configPath, isRunningAction, projectId]
  );

  if (!card) return null;

  const actions = actionsForCard(card);
  const issueLabel = card.issueNumber ? `#${card.issueNumber}` : card.issueId;
  const showException = card.lifecycle === "quarantined" || card.lifecycle === "exception" || card.lifecycle === "failed";
  const exceptionInfo = showException ? buildExceptionInfo(card, detail) : null;

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
        <button className="ns-btn" type="button" onClick={onClose} style={{ ...btnStyle, width: 28, padding: 0, flexShrink: 0, marginRight: 0 }} aria-label="Close issue drawer" title="Close">
          ✕
        </button>
      </div>

      {showException && (
        <div style={{ ...sectionStyle, background: card.lifecycle === "quarantined" ? "#ef444412" : "#d9770612", borderBottomColor: card.lifecycle === "quarantined" ? "#ef444433" : "#d9770633" }}>
          <div style={{ ...sectionTitleStyle, color: card.lifecycle === "quarantined" ? "#ef4444" : "#d97706" }}>Exception</div>
          {!detail && !detailError && <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Loading exception details…</div>}
          {detailError && <div style={{ fontSize: 11, color: "#ef4444" }}>{detailError}</div>}
          {detail && (
            <>
              <div style={{ fontSize: 12, color: "var(--text)", lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                {exceptionInfo?.summary ?? "No exception details recorded in runtime context or history."}
              </div>
              {exceptionInfo && exceptionInfo.details.length > 0 && (
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 7 }}>
                  {exceptionInfo.details.map((item) => (
                    <span key={`${item.label}:${item.value}`} style={{ border: "1px solid var(--border)", borderRadius: 4, padding: "2px 5px", fontSize: 11, color: "var(--text-muted)", background: "var(--bg)" }}>
                      {item.label}: {item.value}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {actions.length > 0 && (
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Actions</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {actions.map((action) => (
              <button
                className="ns-btn"
                key={`${action.command}:${action.targetLifecycle ?? "none"}`}
                type="button"
                onClick={() => runAction(action)}
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
            className="ns-btn"
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
            className="ns-btn"
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
              {detail?.timeline.map((event) => {
                const tone = historyTone(event);
                const style = historyToneStyle[tone];
                return (
                  <div key={event.id} style={{ fontSize: 11, fontFamily: "var(--font-mono)", display: "grid", gridTemplateColumns: "48px minmax(70px, max-content) minmax(0, 1fr)", alignItems: "start", gap: 7, color: style.text, borderLeft: `3px solid ${style.border}`, background: style.bg, borderRadius: 4, padding: "4px 6px" }}>
                    <span style={{ flexShrink: 0, opacity: 0.72 }}>{event.createdAt ? event.createdAt.slice(11, 19) : "—"}</span>
                    <span style={{ border: "1px solid var(--border)", borderRadius: 4, padding: "0 5px", background: style.pill, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {historyStageLabel(event)}
                    </span>
                    <span style={{ minWidth: 0, color: event.severity === "info" ? "var(--text-muted)" : style.text, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{event.summary}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
