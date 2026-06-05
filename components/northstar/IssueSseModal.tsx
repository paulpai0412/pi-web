"use client";

import { useEffect, useMemo, useState } from "react";

import { MessageView } from "@/components/MessageView";
import type {
  NorthstarBoardCard,
  NorthstarHostAdapter,
  NorthstarIssueDetail,
  NorthstarRunEvent,
} from "@/lib/northstar/types";
import type { AgentMessage, ToolResultMessage } from "@/lib/types";

import { usePiSessionSse } from "./usePiSessionSse";
import { useIssueStream } from "./useIssueStream";

interface Props {
  card: NorthstarBoardCard | null;
  projectId: string;
  configPath: string;
  onClose: () => void;
}

type StreamAdapter = "pi" | "codex" | "opencode";

type IssueSseTarget =
  | { type: "events"; key: "events"; label: string }
  | {
      type: "session";
      key: string;
      label: string;
      adapter: StreamAdapter;
      sessionId: string;
      childRunId: string | null;
      rootSessionId: string | null;
    };

function sessionStreamAdapter(adapter: NorthstarHostAdapter | null): StreamAdapter | null {
  if (adapter === "pi" || adapter === "codex" || adapter === "opencode") return adapter;
  return null;
}

function shortId(id: string | null): string {
  if (!id) return "";
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function childRunStage(childRunId: string | null): string {
  const text = childRunId?.toLowerCase() ?? "";
  if (text.includes("verifier") || text.includes("verification") || text.includes("verify")) return "verifier";
  if (text.includes("release")) return "release";
  if (text.includes("implement") || text.includes("implementation")) return "implement";
  return "session";
}

function eventPayload(event: NorthstarRunEvent): Record<string, unknown> | null {
  const value = event.payloadPreview;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function objectField(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function runStreamAdapter(run: Record<string, unknown>): string | null {
  return stringField(run.stream_adapter) ?? stringField(objectField(run.capability_report)?.host);
}

function detailChildRuns(detail: NorthstarIssueDetail | null): Record<string, unknown>[] {
  const runtimeContext = objectField((detail?.snapshot as Record<string, unknown> | undefined)?.runtime_context_json);
  const childRuns = runtimeContext?.child_runs;
  if (!Array.isArray(childRuns)) return [];
  const runs: Record<string, unknown>[] = [];
  for (const run of childRuns) {
    const obj = objectField(run);
    if (obj) runs.push(obj);
  }
  return runs;
}

function detailActiveStreamRun(detail: NorthstarIssueDetail | null): Record<string, unknown> | null {
  const runtimeContext = objectField((detail?.snapshot as Record<string, unknown> | undefined)?.runtime_context_json);
  const ownerLease = objectField(runtimeContext?.owner_lease);
  const childRuns = detailChildRuns(detail);
  if (childRuns.length === 0) return null;

  const candidates = ownerLease
    ? [
        ...childRuns.filter((run) => stringField(run.lease_id) === stringField(ownerLease.lease_id)),
        ...childRuns.filter((run) => stringField(run.role) === stringField(ownerLease.role)),
      ]
    : [...childRuns].reverse();

  return candidates.find((run) => stringField(run.stream_session_id) && runStreamAdapter(run)) ?? null;
}

function buildSessionTargets(card: NorthstarBoardCard, detail: NorthstarIssueDetail | null): IssueSseTarget[] {
  const targets: IssueSseTarget[] = [];
  const seen = new Set<string>();

  const addSession = (
    label: string,
    adapter: StreamAdapter | null,
    sessionId: string | null,
    childRunId: string | null,
    rootSessionId: string | null,
  ) => {
    if (!adapter || !sessionId) return;
    const key = `${adapter}:${sessionId}:${label}`;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({ type: "session", key, label, adapter, sessionId, childRunId, rootSessionId });
  };

  addSession(
    `live ${card.currentStage ?? childRunStage(card.activeStreamChildRunId)} · ${card.activeStreamAdapter ?? card.latestHostAdapter ?? "session"} · ${shortId(card.activeStreamSessionId)}`,
    sessionStreamAdapter(card.activeStreamAdapter ?? card.latestHostAdapter),
    card.activeStreamSessionId,
    card.activeStreamChildRunId,
    card.latestRootSessionId,
  );

  const activeDetailRun = detailActiveStreamRun(detail);
  if (activeDetailRun) {
    const streamAdapter = runStreamAdapter(activeDetailRun);
    const adapter = sessionStreamAdapter(streamAdapter as NorthstarHostAdapter | null);
    const streamSessionId = stringField(activeDetailRun.stream_session_id);
    const streamRootSessionId = stringField(activeDetailRun.stream_root_session_id) ?? stringField(activeDetailRun.root_session_id) ?? streamSessionId;
    const streamChildRunId = stringField(activeDetailRun.stream_child_run_id) ?? stringField(activeDetailRun.child_run_id);
    const role = stringField(activeDetailRun.role);
    const stage = childRunStage(streamChildRunId ?? role);
    addSession(`live ${stage} · ${streamAdapter ?? "session"} · ${shortId(streamSessionId)}`, adapter, streamSessionId, streamChildRunId, streamRootSessionId);
  }

  addSession(
    `${childRunStage(card.latestChildRunId)} · latest root · ${card.latestHostAdapter ?? "session"} · ${shortId(card.latestRootSessionId)}`,
    sessionStreamAdapter(card.latestHostAdapter),
    card.latestRootSessionId,
    card.latestChildRunId,
    card.latestRootSessionId,
  );

  for (const link of detail?.sessionLinks ?? []) {
    const adapter = sessionStreamAdapter(link.streamAdapter ?? link.host);
    const stage = childRunStage(link.childRunId);
    const rootSessionId = link.streamSessionId || link.rootSessionId;
    const rootLabel = `${stage} · root · ${link.host} · ${shortId(rootSessionId)}`;
    addSession(rootLabel, adapter, rootSessionId, link.childRunId, link.rootSessionId);

    const childSessionId = link.streamSessionId || link.sessionId;
    if (childSessionId && childSessionId !== rootSessionId) {
      addSession(`${stage} · child · ${link.host} · ${shortId(childSessionId)}`, adapter, childSessionId, link.childRunId, link.rootSessionId);
    }
  }

  const childRuns = detailChildRuns(detail);
  for (const run of childRuns) {
    const streamAdapter = runStreamAdapter(run);
    const adapter = sessionStreamAdapter(streamAdapter as NorthstarHostAdapter | null);
    const streamSessionId = stringField(run.stream_session_id);
    const streamRootSessionId = stringField(run.stream_root_session_id) ?? streamSessionId;
    const streamChildRunId = stringField(run.stream_child_run_id);
    const plannedChildRunId = stringField(run.child_run_id);
    const role = stringField(run.role);
    const stage = childRunStage(streamChildRunId ?? plannedChildRunId ?? role);
    addSession(`${stage} · root · ${streamAdapter ?? "session"} · ${shortId(streamRootSessionId)}`, adapter, streamRootSessionId, plannedChildRunId, streamRootSessionId);
    addSession(`${stage} · child · ${streamAdapter ?? "session"} · ${shortId(streamChildRunId ?? plannedChildRunId)}`, adapter, streamSessionId, streamChildRunId ?? plannedChildRunId, streamRootSessionId);
  }

  const hasStructuredHistory = targets.some((target) => (
    target.type === "session" &&
    !target.label.startsWith("live ") &&
    !target.label.includes("latest root")
  ));
  if (!hasStructuredHistory) {
    for (const event of detail?.timeline ?? []) {
      if (event.eventType !== "host_stream_session_recorded") continue;
      const payload = eventPayload(event);
      const streamSessionId = stringField(payload?.stream_session_id);
      const childRunId = stringField(payload?.child_run_id);
      const streamAdapter = stringField(payload?.stream_adapter);
      const role = stringField(payload?.role);
      const stage = childRunStage(childRunId ?? role);
      const adapter = sessionStreamAdapter(streamAdapter as NorthstarHostAdapter | null);
      addSession(`${stage} · stream · ${streamAdapter ?? "session"} · ${shortId(streamSessionId)}`, adapter, streamSessionId, childRunId, null);
    }
  }

  targets.push({ type: "events", key: "events", label: "Issue events" });
  return targets;
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
  const [detail, setDetail] = useState<NorthstarIssueDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(null);
  const cardIssueId = card?.issueId ?? null;

  useEffect(() => {
    if (!cardIssueId) {
      setDetail(null);
      setDetailError(null);
      setSelectedTargetKey(null);
      return;
    }

    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setSelectedTargetKey(null);
    const url = `/api/northstar/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(cardIssueId)}?config=${encodeURIComponent(configPath)}`;
    fetch(url)
      .then(async (res) => {
        const body = (await res.json()) as { issue?: NorthstarIssueDetail; error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        return body.issue ?? null;
      })
      .then((issue) => {
        if (!cancelled) setDetail(issue);
      })
      .catch((error) => {
        if (!cancelled) setDetailError(String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [cardIssueId, configPath, projectId]);

  const targets = useMemo(() => (card ? buildSessionTargets(card, detail) : []), [card, detail]);
  const selectedTarget = useMemo(() => {
    if (targets.length === 0) return null;
    return targets.find((target) => target.key === selectedTargetKey) ?? targets[0];
  }, [selectedTargetKey, targets]);

  const useSessionStream = selectedTarget?.type === "session";
  const sessionId = useSessionStream ? selectedTarget.sessionId : null;
  const streamAdapter = useSessionStream ? selectedTarget.adapter : null;
  const {
    messages,
    streamingMessage,
    isLive: piLive,
    isReconnecting,
    reconnectAttempts,
    reconnectNow,
    clear,
    error: piError,
  } = usePiSessionSse(sessionId, streamAdapter ?? "pi");
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
              {useSessionStream && selectedTarget.childRunId ? <span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>child: {selectedTarget.childRunId}</span> : null}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
            {useSessionStream && reconnectAttempts >= 5 && <button className="ns-btn" type="button" onClick={reconnectNow} style={btnStyle}>Reconnect</button>}
            {useSessionStream && <button className="ns-btn" type="button" onClick={clear} style={btnStyle}>Clear</button>}
            <button className="ns-btn" type="button" onClick={onClose} style={btnStyle}>Close</button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
          <label htmlFor="issue-sse-target" style={{ fontSize: 11, color: "var(--text-dim)", flexShrink: 0 }}>
            session
          </label>
          <select
            id="issue-sse-target"
            value={selectedTarget?.key ?? ""}
            onChange={(event) => setSelectedTargetKey(event.target.value)}
            style={{
              flex: 1,
              minWidth: 0,
              height: 28,
              border: "1px solid var(--border)",
              borderRadius: 5,
              background: "var(--bg-panel)",
              color: "var(--text)",
              fontSize: 12,
              padding: "0 8px",
            }}
          >
            {targets.map((target) => (
              <option key={target.key} value={target.key}>
                {target.label}
              </option>
            ))}
          </select>
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
          {detailError && (
            <div style={{ color: "#d97706", fontSize: 11, marginTop: 8 }}>Session history unavailable: {detailError}</div>
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
