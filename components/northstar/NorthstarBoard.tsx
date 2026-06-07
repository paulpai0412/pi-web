"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type {
  NorthstarBoard as NorthstarBoardModel,
  NorthstarBoardCard,
  NorthstarLifecycleState,
  NorthstarProjectSummary,
} from "@/lib/northstar/types";

import { IssueDrawer } from "./IssueDrawer";
import { IssueSsePanel } from "./IssueSseModal";

const LIFECYCLE_ORDER: NorthstarLifecycleState[] = [
  "ready", "claimed", "running", "verifying", "verified",
  "release_pending", "releasing", "exception", "completed", "cancelled", "failed", "quarantined",
];

const PENDING_STATES: NorthstarLifecycleState[] = [
  "ready",
  "claimed",
  "running",
  "verifying",
  "verified",
  "release_pending",
  "releasing",
  "exception",
];

const NORTHSTAR_ROOT = "/home/timmypai/apps/northstar";

type ShellExit = { code: number | null; signal: string | null };
type ShellEvent =
  | { type: "start"; cwd: string; shell: string; command: string }
  | { type: "stdout"; text: string }
  | { type: "stderr"; text: string }
  | { type: "exit"; code: number | null; signal: string | null }
  | { type: "error"; message: string };

interface WatchProcessInfo {
  pid: number;
  ppid: number;
  stat: string;
  elapsed: string;
  command: string;
  lockOwner: boolean;
}

interface WatchStatus {
  running: boolean;
  lock: {
    pid: number;
    heartbeat_at: string;
    project_root: string;
    config_path: string;
    host: string;
    lease_id: string;
  } | null;
  lockPidAlive: boolean;
  heartbeatAgeSeconds: number | null;
  processes: WatchProcessInfo[];
  lockPath: string;
}

function apiPath(path: string, configPath: string) {
  return `${path}?config=${encodeURIComponent(configPath)}`;
}

async function readJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const payload = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(payload.error ?? `Northstar request failed with ${res.status}`);
  return payload;
}

function isProblem(card: NorthstarBoardCard): "red" | "orange" | null {
  if (card.lifecycle === "quarantined" || card.lifecycle === "failed") return "red";
  if (card.lifecycle === "exception") return "orange";
  if (card.blocked || card.projectionFailure) return "orange";
  return null;
}

function sortedCards(cards: NorthstarBoardCard[]): NorthstarBoardCard[] {
  return [...cards].sort((a, b) => {
    const pa = isProblem(a) === "red" ? 0 : isProblem(a) === "orange" ? 1 : 2;
    const pb = isProblem(b) === "red" ? 0 : isProblem(b) === "orange" ? 1 : 2;
    return pa - pb;
  });
}

function statusDotColor(card: NorthstarBoardCard): string {
  const p = isProblem(card);
  if (p === "red") return "#ef4444";
  if (p === "orange") return "#d97706";
  if (card.lifecycle === "completed") return "#16a34a";
  return "var(--accent)";
}

function countPending(board: NorthstarBoardModel): number {
  const map = new Map(board.groups.map((g) => [g.lifecycle, g.cards.length]));
  return PENDING_STATES.reduce((sum, state) => sum + (map.get(state) ?? 0), 0);
}

function compactNumber(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0";
  if (value >= 1_000_000) return `${trimNumber(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimNumber(value / 1_000)}k`;
  return String(Math.round(value));
}

function trimNumber(value: number): string {
  return value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "");
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0m";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours}h${rest}m` : `${hours}h`;
}

function formatCost(value: number | undefined): string {
  const amount = typeof value === "number" && Number.isFinite(value) ? value : 0;
  if (amount <= 0) return "-";
  return amount >= 0.01 ? `$${amount.toFixed(2)}` : "<$0.01";
}

function telemetryTitle(card: NorthstarBoardCard): string {
  const telemetry = card.telemetry;
  if (!telemetry) return "No telemetry recorded";
  return [
    `duration: ${formatDuration(telemetry.durationMs)}`,
    `errors: ${telemetry.errorCount}`,
    `tokens: ${telemetry.tokenUsage.total.toLocaleString()}`,
    `cost: ${telemetry.cost.known ? `$${telemetry.cost.estimatedUsd.toFixed(4)}` : "unknown"}`,
    `sessions: ${telemetry.knownTokenSessionCount}/${telemetry.sessionCount} with token usage`,
  ].join("\n");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function defaultShellCommand(configPath: string): string {
  return [
    "node",
    shellQuote(`${NORTHSTAR_ROOT}/src/cli/entrypoint.ts`),
    "watch",
    "--config",
    shellQuote(configPath),
    "--max-cycles",
    "300",
    "--interval-ms",
    "5000",
    "--log-json",
  ].join(" ");
}

function shellCommandStorageKey(configPath: string): string {
  return `northstar.shellCommand:${configPath}`;
}

function isWatchCommand(command: string): boolean {
  return /(?:^|\s)watch(?:\s|$)/.test(command);
}

const centeredStyle: React.CSSProperties = {
  height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
  padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6,
};

const contextPanelTop = 92;
const contextPanelRight = 18;
const contextPanelWidth = 440;
const contextPanelBottomGap = 20;

const iconStroke: React.CSSProperties = { width: 14, height: 14, display: "block" };

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStroke}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function StreamIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStroke}>
      <circle cx="12" cy="12" r="2" />
      <path d="M16.24 7.76a6 6 0 0 1 0 8.48" />
      <path d="M7.76 16.24a6 6 0 0 1 0-8.48" />
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
      <path d="M4.93 19.07a10 10 0 0 1 0-14.14" />
    </svg>
  );
}

function PrIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStroke}>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 9v9a3 3 0 0 0 3 3h6" />
      <path d="M18 15V6" />
    </svg>
  );
}

function IssueIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5" />
      <circle cx="12" cy="16.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

interface CardProps {
  card: NorthstarBoardCard;
  repo: string;
  selected: boolean;
  onClick: () => void;
  onOpenSse: () => void;
}

function BoardCard({ card, repo, selected, onClick, onOpenSse }: CardProps) {
  const problem = isProblem(card);
  const issueLabel = card.issueNumber ? `#${card.issueNumber}` : card.issueId;
  const issueUrl = card.issueNumber ? `https://github.com/${repo}/issues/${card.issueNumber}` : null;
  const telemetry = card.telemetry;

  return (
    <article
      className="ns-surface-interactive"
      onClick={onClick}
      style={{
        border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
        borderRadius: 6, background: selected ? "var(--bg-selected)" : "var(--bg)", color: "var(--text)",
        padding: 10, minWidth: 0, boxSizing: "border-box", cursor: "pointer",
        transition: "background 140ms ease, border-color 140ms ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ color: "var(--text-muted)", fontSize: 11, flexShrink: 0 }}>{issueLabel}</span>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: statusDotColor(card), flexShrink: 0 }} />
        {problem && <span style={{ fontSize: 11, color: problem === "red" ? "#ef4444" : "#d97706" }}>⚠</span>}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600 }}>
          {card.title}
        </span>
      </div>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
        <span style={{ border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px" }}>{card.currentStage ?? "no stage"}</span>
        {card.latestHostAdapter && <span style={{ border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px" }}>host: {card.latestHostAdapter}</span>}
        <span style={{ border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px" }}>deps {card.dependencyCount}</span>
        {telemetry && (
          <>
            <span title={telemetryTitle(card)} style={{ border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px" }}>{formatDuration(telemetry.durationMs)}</span>
            <span title={telemetryTitle(card)} style={{ border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px", color: telemetry.errorCount > 0 ? "#ef4444" : "var(--text-muted)" }}>!{telemetry.errorCount}</span>
            <span title={telemetryTitle(card)} style={{ border: "1px solid var(--border)", borderRadius: 3, padding: "1px 5px" }}>{compactNumber(telemetry.tokenUsage.total)} tok</span>
          </>
        )}
      </div>
      <div style={{ marginTop: 5, fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        next: {card.nextRecommendedAction}
      </div>
      <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {issueUrl && (
          <a
            className="ns-btn"
            href={issueUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="View GitHub Issue"
            aria-label="View GitHub Issue"
            style={{
              width: 24,
              height: 22,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg-panel)",
              color: "var(--text)",
              textDecoration: "none",
            }}
          >
            <IssueIcon />
          </a>
        )}
        {card.prUrl && (
          <a
            className="ns-btn"
            href={card.prUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="View PR"
            aria-label="View PR"
            style={{
              width: 24,
              height: 22,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid var(--border)",
              borderRadius: 4,
              background: "var(--bg-panel)",
              color: "var(--text)",
              textDecoration: "none",
            }}
          >
            <PrIcon />
          </a>
        )}
        <button
          className="ns-btn"
          type="button"
          title="Issue SSE"
          aria-label="Issue SSE"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSse();
          }}
          style={{ ...headerIconButtonStyle, width: 24, height: 22, borderRadius: 4 }}
        >
          <StreamIcon />
        </button>
      </div>
    </article>
  );
}

interface ColumnProps {
  lifecycle: NorthstarLifecycleState;
  cards: NorthstarBoardCard[];
  repo: string;
  initiallyCollapsed: boolean;
  onCardClick: (card: NorthstarBoardCard) => void;
  onOpenSse: (card: NorthstarBoardCard) => void;
  selectedIssueId: string | null;
}

function Column({ lifecycle, cards, repo, initiallyCollapsed, onCardClick, onOpenSse, selectedIssueId }: ColumnProps) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  useEffect(() => {
    if (!initiallyCollapsed) setCollapsed(false);
  }, [initiallyCollapsed]);
  const label = lifecycle.replace(/_/g, " ");
  const sorted = sortedCards(cards);

  if (collapsed) {
    return (
      <div
        className="ns-surface-interactive"
        onClick={() => setCollapsed(false)}
        title={`${label} (${cards.length})`}
        style={{
          width: 28, flexShrink: 0, border: "1px solid var(--border)", borderRadius: 6,
          background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", color: "var(--text-muted)",
        }}
      >
        <span style={{ writingMode: "vertical-rl", fontSize: 11, fontWeight: 700, textTransform: "capitalize", transform: "rotate(180deg)", letterSpacing: 1 }}>
          {label} {cards.length > 0 ? `(${cards.length})` : ""}
        </span>
      </div>
    );
  }

  return (
    <section className="northstar-state-column" style={{ display: "flex", flexDirection: "column", minWidth: 220, maxWidth: 280, flex: "1 1 220px", height: "100%", minHeight: 0, border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", overflow: "hidden" }}>
      <div className="ns-surface-interactive" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderBottom: "1px solid var(--border)", cursor: "pointer", flexShrink: 0 }}
        onClick={() => setCollapsed(true)}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textTransform: "capitalize" }}>{label}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{cards.length}</span>
      </div>
      <div className="northstar-state-scroll" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", gap: 8, padding: 8, overflowY: "auto", overflowX: "hidden", scrollbarGutter: "stable" }}>
        {sorted.length === 0
          ? <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "4px 2px" }}>No issues</div>
          : sorted.map((card) => (
            <BoardCard
              key={card.issueId}
              card={card}
              repo={repo}
              selected={card.issueId === selectedIssueId}
              onClick={() => onCardClick(card)}
              onOpenSse={() => onOpenSse(card)}
            />
          ))
        }
      </div>
    </section>
  );
}

type ContextTab = "chat" | "issue" | "sse" | "watch";

export function NorthstarBoard({ configPath, chatPanel }: { configPath: string | null; chatPanel?: ReactNode }) {
  const [board, setBoard] = useState<NorthstarBoardModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<NorthstarBoardCard | null>(null);
  const [contextTab, setContextTab] = useState<ContextTab>("chat");
  const [contextPanelOpen, setContextPanelOpen] = useState(false);

  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [shellCommand, setShellCommand] = useState("");
  const [shellCommandSaved, setShellCommandSaved] = useState(false);
  const [shellOutput, setShellOutput] = useState("");
  const [shellRunning, setShellRunning] = useState(false);
  const [shellError, setShellError] = useState<string | null>(null);
  const [shellExit, setShellExit] = useState<ShellExit | null>(null);
  const [watchStatus, setWatchStatus] = useState<WatchStatus | null>(null);
  const [watchStatusError, setWatchStatusError] = useState<string | null>(null);
  const [watchStopping, setWatchStopping] = useState(false);
  const shellAbortRef = useRef<AbortController | null>(null);
  const shellOutputRef = useRef<HTMLPreElement | null>(null);

  const load = useCallback(async (cfg: string | null) => {
    if (!cfg) { setBoard(null); setError(null); return; }
    setLoading(true); setError(null);
    try {
      const { projects } = await readJson<{ projects: NorthstarProjectSummary[] }>(apiPath("/api/northstar/projects", cfg));
      const project = projects[0];
      if (!project) { setBoard(null); setError("No Northstar project found for this config."); return; }
      const { board: b } = await readJson<{ board: NorthstarBoardModel }>(
        apiPath(`/api/northstar/projects/${encodeURIComponent(project.projectId)}`, cfg)
      );
      setBoard(b);
    } catch (e) {
      setBoard(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshWatchStatus = useCallback(async () => {
    if (!configPath) {
      setWatchStatus(null);
      setWatchStatusError(null);
      return null;
    }
    try {
      const status = await readJson<WatchStatus>(`/api/northstar/shell?config=${encodeURIComponent(configPath)}`);
      setWatchStatus(status);
      setWatchStatusError(null);
      return status;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setWatchStatusError(message);
      return null;
    }
  }, [configPath]);

  const killWatchProcess = useCallback(async (force: boolean) => {
    if (!configPath || watchStopping) return;
    setWatchStopping(true);
    setShellError(null);
    try {
      const res = await fetch("/api/northstar/shell", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: configPath, force }),
      });
      const payload = (await res.json().catch(() => null)) as { error?: string; results?: Array<{ pid: number; signal: string; ok: boolean; error?: string }> } | null;
      if (!res.ok) throw new Error(payload?.error ?? `Stop failed with ${res.status}`);
      const lines = payload?.results?.map((result) => (
        `[watch ${force ? "kill" : "stop"}] pid=${result.pid} signal=${result.signal} ${result.ok ? "ok" : `failed ${result.error ?? ""}`}`
      )) ?? [`[watch ${force ? "kill" : "stop"}] no matching process`];
      setShellOutput((prev) => `${prev}${prev.endsWith("\n") || !prev ? "" : "\n"}${lines.join("\n")}\n`);
      await refreshWatchStatus();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setShellError(message);
      setShellOutput((prev) => `${prev}${prev.endsWith("\n") || !prev ? "" : "\n"}[error] ${message}\n`);
    } finally {
      setWatchStopping(false);
    }
  }, [configPath, refreshWatchStatus, watchStopping]);

  const stopShellCommand = useCallback(() => {
    shellAbortRef.current?.abort();
    shellAbortRef.current = null;
    setShellRunning(false);
    setShellOutput((prev) => `${prev}${prev.endsWith("\n") || !prev ? "" : "\n"}[terminated]\n`);
    void killWatchProcess(false);
  }, [killWatchProcess]);

  const appendShellEvent = useCallback((event: ShellEvent) => {
    if (event.type === "start") {
      setShellOutput((prev) => `${prev}[cwd] ${event.cwd}\n[shell] ${event.shell}\n`);
      return;
    }
    if (event.type === "stdout" || event.type === "stderr") {
      setShellOutput((prev) => `${prev}${event.text}`);
      return;
    }
    if (event.type === "error") {
      setShellError(event.message);
      setShellOutput((prev) => `${prev}${prev.endsWith("\n") || !prev ? "" : "\n"}[error] ${event.message}\n`);
      return;
    }
    setShellExit({ code: event.code, signal: event.signal });
    setShellOutput((prev) => `${prev}${prev.endsWith("\n") || !prev ? "" : "\n"}[exit] code=${event.code ?? "null"} signal=${event.signal ?? "null"}\n`);
  }, []);

  const runShellCommand = useCallback(async () => {
    if (!configPath) return;
    const command = shellCommand.trim();
    if (!command || shellRunning) return;
    if (isWatchCommand(command)) {
      const status = await refreshWatchStatus();
      if (status?.running) {
        const pid = status.lock?.pid ?? status.processes[0]?.pid;
        setShellError(`Northstar watch is already running${pid ? ` (pid ${pid})` : ""}. Stop or Force Kill it before running again.`);
        setShellOutput((prev) => `${prev}${prev.endsWith("\n") || !prev ? "" : "\n"}[blocked] Northstar watch is already running${pid ? ` pid=${pid}` : ""}\n`);
        return;
      }
    }

    const controller = new AbortController();
    shellAbortRef.current = controller;
    setShellRunning(true);
    setShellError(null);
    setShellExit(null);
    setShellOutput(`$ ${command}\n`);
    setContextTab("watch");
    setContextPanelOpen(true);

    try {
      const res = await fetch("/api/northstar/shell", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: configPath, command }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? `Shell request failed with ${res.status}`);
      }
      if (!res.body) throw new Error("Shell response did not include a stream");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          appendShellEvent(JSON.parse(line) as ShellEvent);
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) appendShellEvent(JSON.parse(buffer) as ShellEvent);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) {
        const message = e instanceof Error ? e.message : String(e);
        setShellError(message);
        setShellOutput((prev) => `${prev}${prev.endsWith("\n") || !prev ? "" : "\n"}[error] ${message}\n`);
      }
    } finally {
      if (shellAbortRef.current === controller) shellAbortRef.current = null;
      setShellRunning(false);
      void refreshWatchStatus();
    }
  }, [appendShellEvent, configPath, refreshWatchStatus, shellCommand, shellRunning]);

  const saveShellCommand = useCallback(() => {
    if (!configPath) return;
    const command = shellCommand.trim();
    if (!command) return;
    try {
      window.localStorage.setItem(shellCommandStorageKey(configPath), command);
      setShellCommand(command);
      setShellCommandSaved(true);
    } catch {
      setShellCommandSaved(false);
    }
  }, [configPath, shellCommand]);

  useEffect(() => {
    void load(configPath);
  }, [configPath, load]);

  useEffect(() => {
    if (!configPath) {
      setShellCommand("");
      setShellCommandSaved(false);
      setShellOutput("");
      setShellError(null);
      setShellExit(null);
      setWatchStatus(null);
      setWatchStatusError(null);
      return;
    }
    const fallback = defaultShellCommand(configPath);
    try {
      const stored = window.localStorage.getItem(shellCommandStorageKey(configPath));
      if (stored?.trim()) {
        setShellCommand(stored.trim());
        setShellCommandSaved(true);
      } else {
        setShellCommand(fallback);
        setShellCommandSaved(false);
      }
    } catch {
      setShellCommand(fallback);
      setShellCommandSaved(false);
    }
    setShellOutput("");
    setShellError(null);
    setShellExit(null);
    void refreshWatchStatus();
  }, [configPath, refreshWatchStatus]);

  useEffect(() => {
    if (!configPath || contextTab !== "watch" || !contextPanelOpen) return;
    void refreshWatchStatus();
    const timer = setInterval(() => void refreshWatchStatus(), 3000);
    return () => clearInterval(timer);
  }, [configPath, contextPanelOpen, contextTab, refreshWatchStatus]);

  useEffect(() => {
    if (!autoRefreshEnabled || !configPath) return;
    const timer = setInterval(() => {
      void load(configPath);
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [autoRefreshEnabled, configPath, load]);

  useEffect(() => {
    if (!board || !selectedCard) return;
    const latestCard = board.groups.flatMap((group) => group.cards).find((card) => card.issueId === selectedCard.issueId);
    if (latestCard && latestCard !== selectedCard) setSelectedCard(latestCard);
  }, [board, selectedCard]);

  const pendingCount = useMemo(() => (board ? countPending(board) : 0), [board]);

  const handleSelectCard = useCallback((card: NorthstarBoardCard) => {
    setSelectedCard(card);
    setContextTab("issue");
    setContextPanelOpen(true);
  }, []);

  const handleOpenSse = useCallback((card: NorthstarBoardCard) => {
    setSelectedCard(card);
    setContextTab("sse");
    setContextPanelOpen(true);
  }, []);

  const openContextTab = useCallback((tab: ContextTab) => {
    setContextTab(tab);
    setContextPanelOpen(true);
  }, []);

  useEffect(() => {
    const node = shellOutputRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [shellOutput]);

  if (!configPath) return <div style={centeredStyle}>Select a project directory with a <code>.northstar.yaml</code> file.</div>;
  if (loading && !board) return <div style={centeredStyle}>Loading Northstar board…</div>;
  if (error) return (
    <div style={centeredStyle}>
      <div>
        <div style={{ color: "var(--text)", fontWeight: 600, marginBottom: 6 }}>Couldn&apos;t load the Northstar board</div>
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{error}</div>
        <button type="button" onClick={() => void load(configPath)} style={{ marginTop: 12, padding: "5px 12px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer" }}>Retry</button>
      </div>
    </div>
  );
  if (!board) return <div style={centeredStyle}>No Northstar board loaded.</div>;
  const allCards = board.groups.flatMap((g) => g.cards);
  const redCount = allCards.filter((c) => c.lifecycle === "quarantined" || c.lifecycle === "failed").length;
  const orangeCount = allCards.filter((c) =>
    c.lifecycle === "exception" || ((c.blocked || c.projectionFailure) && c.lifecycle !== "quarantined" && c.lifecycle !== "failed")
  ).length;
  const problemCount = redCount + orangeCount;

  const cardsByLifecycle = new Map(board.groups.map((g) => [g.lifecycle, g.cards]));
  const watchRunning = watchStatus?.running ?? false;
  const watchPid = watchStatus?.lock?.pid ?? watchStatus?.processes[0]?.pid ?? null;
  const commandIsWatch = isWatchCommand(shellCommand.trim());
  const runDisabled = shellRunning || !shellCommand.trim() || (commandIsWatch && watchRunning);
  const runBlockedReason = commandIsWatch && watchRunning
    ? `watch already running${watchPid ? ` pid=${watchPid}` : ""}`
    : "";
  const projectTelemetry = board.project.telemetry;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg)", flexShrink: 0, minWidth: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 650, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{board.project.name}</div>
          <div style={{ display: "flex", gap: "3px 10px", flexWrap: "wrap", marginTop: 1, color: "var(--text-muted)", fontSize: 11 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{board.project.repo}</span>
            <span style={{ flexShrink: 0 }}>host: {board.project.hostAdapter}</span>
            <span style={{ fontSize: 11, color: shellRunning ? "#16a34a" : "var(--text-dim)" }}>
              terminal: {shellRunning ? "running" : "idle"}
            </span>
            <span style={{ fontSize: 11, color: watchRunning ? "#16a34a" : "var(--text-dim)" }}>
              watch: {watchRunning ? `pid ${watchPid ?? "?"}` : "stopped"}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>pending: {pendingCount}</span>
            {projectTelemetry && (
              <>
                <span style={{ color: "var(--text-dim)" }}>done {projectTelemetry.completion.completed}/{projectTelemetry.completion.total} {projectTelemetry.completion.percent}%</span>
                <span style={{ color: "var(--text-dim)" }}>active {projectTelemetry.activeCount}</span>
                <span style={{ color: projectTelemetry.attentionCount > 0 ? "#d97706" : "var(--text-dim)" }}>attention {projectTelemetry.attentionCount}</span>
                <span style={{ color: projectTelemetry.errorCount > 0 ? "#ef4444" : "var(--text-dim)" }}>errors {projectTelemetry.errorCount}</span>
                <span style={{ color: "var(--text-dim)" }}>time {formatDuration(projectTelemetry.durationMs)}</span>
                <span style={{ color: "var(--text-dim)" }} title={`${projectTelemetry.knownTokenSessionCount}/${projectTelemetry.sessionCount} sessions with known token usage`}>
                  tokens {compactNumber(projectTelemetry.tokenUsage.total)}
                </span>
                <span style={{ color: "var(--text-dim)" }}>cost {formatCost(projectTelemetry.cost.known ? projectTelemetry.cost.estimatedUsd : undefined)}</span>
              </>
            )}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <button className="ns-btn" type="button" title="Refresh" aria-label="Refresh" onClick={() => void load(configPath)} style={headerIconButtonStyle}><RefreshIcon /></button>
          <label title="Auto refresh every 60 seconds" style={{ height: 26, display: "inline-flex", alignItems: "center", gap: 5, padding: "0 8px", border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-panel)", fontSize: 11, color: "var(--text-muted)", cursor: "pointer", whiteSpace: "nowrap" }}>
            <input
              type="checkbox"
              checked={autoRefreshEnabled}
              onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
              style={{ accentColor: "var(--accent)", margin: 0 }}
            />
            60s
          </label>
        </div>
      </div>

      {problemCount > 0 && (
        <div style={{ padding: "6px 14px", background: "#7c1d1d22", borderBottom: "1px solid #ef444433", fontSize: 12, color: "#ef4444", flexShrink: 0 }}>
          ⚠ {problemCount} issue{problemCount > 1 ? "s" : ""} need attention:
          {redCount > 0 && ` quarantined/failed ×${redCount}`}
          {orangeCount > 0 && ` blocked ×${orangeCount}`}
        </div>
      )}

      <div className="northstar-workbench-main" style={{ flex: 1, minHeight: 0, overflow: "hidden", position: "relative" }}>
        <div style={{ height: "100%", minWidth: 0, overflow: "auto", padding: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
          {LIFECYCLE_ORDER.filter((lifecycle) => (cardsByLifecycle.get(lifecycle) ?? []).length > 0).map((lifecycle) => {
            const cards = cardsByLifecycle.get(lifecycle) ?? [];
            return (
              <Column
                key={lifecycle}
                lifecycle={lifecycle}
                cards={cards}
                repo={board.project.repo}
                initiallyCollapsed={false}
                onCardClick={handleSelectCard}
                onOpenSse={handleOpenSse}
                selectedIssueId={selectedCard?.issueId ?? null}
              />
            );
          })}
          {LIFECYCLE_ORDER.every((lifecycle) => (cardsByLifecycle.get(lifecycle) ?? []).length === 0) && (
            <div style={{ fontSize: 12, color: "var(--text-dim)", padding: 6 }}>No issues on the board.</div>
          )}
        </div>

        {!contextPanelOpen && (
          <div
            aria-label="Open context panel"
            style={{
              position: "fixed",
              top: contextPanelTop,
              right: contextPanelRight,
              zIndex: 940,
              display: "flex",
              gap: 6,
              padding: 6,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
              boxShadow: "0 10px 28px rgba(0,0,0,0.18)",
            }}
          >
            {([
              { id: "chat", label: "Chat" },
              { id: "issue", label: selectedCard?.issueNumber ? `Issue #${selectedCard.issueNumber}` : "Issue" },
              { id: "sse", label: "SSE" },
              { id: "watch", label: "Watch" },
            ] as { id: ContextTab; label: string }[]).map((tab) => (
              <button
                key={tab.id}
                className="ns-btn"
                type="button"
                onClick={() => openContextTab(tab.id)}
                style={{ ...btnLikeStyle, height: 26, background: contextTab === tab.id ? "var(--bg-selected)" : "var(--bg-panel)" }}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}

        {contextPanelOpen && (
          <aside
            className="northstar-context-panel"
            style={{
              position: "fixed",
              top: contextPanelTop,
              right: contextPanelRight,
              zIndex: 950,
              width: `min(${contextPanelWidth}px, calc(100% - ${contextPanelRight * 2}px))`,
              height: `calc(100vh - ${contextPanelTop + contextPanelBottomGap}px)`,
              maxWidth: `min(${contextPanelWidth}px, calc(100% - ${contextPanelRight * 2}px))`,
              maxHeight: `calc(100vh - ${contextPanelTop + contextPanelBottomGap}px)`,
              minWidth: 0,
              border: "1px solid var(--border)",
              borderRadius: 6,
              background: "var(--bg)",
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              overflow: "hidden",
              boxShadow: "0 18px 48px rgba(0,0,0,0.24)",
            }}
          >
          <div style={{ display: "flex", alignItems: "stretch", height: 34, borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
            {([
              { id: "chat", label: "Chat", disabled: false },
              { id: "issue", label: selectedCard?.issueNumber ? `Issue #${selectedCard.issueNumber}` : "Issue", disabled: false },
              { id: "sse", label: "SSE", disabled: false },
              { id: "watch", label: "Watch", disabled: false },
            ] as { id: ContextTab; label: string; disabled: boolean }[]).map((tab) => {
              const active = contextTab === tab.id;
              return (
                <button
                  key={tab.id}
                  className="ns-btn"
                  type="button"
                  onClick={() => setContextTab(tab.id)}
                  disabled={tab.disabled}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: "none",
                    borderRight: "1px solid var(--border)",
                    borderTop: active ? "2px solid var(--accent)" : "2px solid transparent",
                    background: active ? "var(--bg-selected)" : "var(--bg-panel)",
                    color: active ? "var(--text)" : "var(--text-muted)",
                    fontSize: 11,
                    cursor: tab.disabled ? "default" : "pointer",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {tab.label}
                </button>
              );
            })}
            <button
              className="ns-btn"
              type="button"
              onClick={() => setContextPanelOpen(false)}
              style={{
                width: 34,
                border: "none",
                borderTop: "2px solid transparent",
                background: "var(--bg-panel)",
                color: "var(--text-muted)",
                cursor: "pointer",
                flexShrink: 0,
              }}
              aria-label="Close context panel"
              title="Close"
            >
              ✕
            </button>
          </div>

          <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
            {contextTab === "chat" ? (
              chatPanel ?? (
                <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12 }}>
                  Chat is unavailable for this workspace.
                </div>
              )
            ) : contextTab === "issue" ? (
              <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
                {selectedCard && (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {selectedCard.title}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                        stage: {selectedCard.currentStage ?? "none"} · host: {selectedCard.latestHostAdapter ?? "unknown"}
                      </div>
                    </div>
                  </div>
                )}
                {selectedCard && (
                  <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
                    <IssueDrawer
                      card={selectedCard}
                      projectId={board.project.projectId}
                      configPath={configPath}
                      embedded
                      autoRefreshEnabled={autoRefreshEnabled}
                    />
                  </div>
                )}
                {!selectedCard && (
                  <div style={{ flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)", fontSize: 12, padding: 16, textAlign: "center" }}>
                    Select an issue card to view details.
                  </div>
                )}
              </div>
            ) : contextTab === "sse" ? (
              <IssueSsePanel
                card={selectedCard}
                projectId={board.project.projectId}
                configPath={configPath}
                embedded
              />
            ) : (
              <div style={{ height: "100%", minHeight: 0, display: "flex", flexDirection: "column" }}>
                <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: watchRunning ? "#16a34a" : shellRunning ? "#d97706" : "var(--text-dim)" }}>
                      {watchRunning ? `watch pid ${watchPid ?? "?"}` : shellRunning ? "shell running" : shellCommandSaved ? "command saved" : "idle"}
                      {watchStatus?.heartbeatAgeSeconds !== null && watchStatus?.heartbeatAgeSeconds !== undefined ? ` · heartbeat ${watchStatus.heartbeatAgeSeconds}s` : ""}
                      {shellExit ? ` · last exit ${shellExit.code ?? "null"}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="ns-btn" type="button" onClick={() => void refreshWatchStatus()} style={btnLikeStyle}>Refresh</button>
                    {(shellRunning || watchRunning) && <button className="ns-btn" type="button" onClick={stopShellCommand} disabled={watchStopping} style={{ ...btnLikeStyle, opacity: watchStopping ? 0.55 : 1 }}>Stop</button>}
                    {watchRunning && <button className="ns-btn" type="button" onClick={() => void killWatchProcess(true)} disabled={watchStopping} style={{ ...btnLikeStyle, borderColor: "#ef4444", color: "#ef4444", opacity: watchStopping ? 0.55 : 1 }}>Force Kill</button>}
                    <button
                      className="ns-btn"
                      type="button"
                      onClick={() => void runShellCommand()}
                      disabled={runDisabled}
                      title={runBlockedReason}
                      style={{ ...btnLikeStyle, background: "var(--accent)", borderColor: "var(--accent)", color: "white", opacity: runDisabled ? 0.55 : 1 }}
                    >
                      Run
                    </button>
                  </div>
                </div>
                <div style={{ flexShrink: 0, padding: "7px 12px", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", fontSize: 11, color: "var(--text-muted)" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 10px" }}>
                    <span>lock: {watchStatus?.lock ? "present" : "none"}</span>
                    <span>owner: {watchStatus?.lockPidAlive ? "alive" : watchStatus?.lock ? "not visible" : "none"}</span>
                    <span>pid: {watchPid ?? "none"}</span>
                    <span>processes: {watchStatus?.processes.length ?? 0}</span>
                  </div>
                  {watchStatus?.lockPath && (
                    <div style={{ marginTop: 4, fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {watchStatus.lockPath}
                    </div>
                  )}
                  {watchStatus?.processes.length ? (
                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                      {watchStatus.processes.map((proc) => (
                        <div key={proc.pid} style={{ fontFamily: "var(--font-mono)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {proc.lockOwner ? "* " : ""}pid={proc.pid} ppid={proc.ppid} {proc.elapsed} {proc.command}
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {runBlockedReason && <div style={{ marginTop: 5, color: "#d97706" }}>{runBlockedReason}. Stop or Force Kill before running again.</div>}
                  {watchStatusError && <div style={{ marginTop: 5, color: "#ef4444" }}>{watchStatusError}</div>}
                </div>
                <div style={{ flexShrink: 0, padding: 10, borderBottom: "1px solid var(--border)", background: "var(--tool-bg)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Command</div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button
                        className="ns-btn"
                        type="button"
                        onClick={() => { if (configPath) { setShellCommand(defaultShellCommand(configPath)); setShellCommandSaved(false); } }}
                        disabled={shellRunning}
                        title="Restore the default command text"
                        style={{ ...btnLikeStyle, opacity: shellRunning ? 0.55 : 1, whiteSpace: "nowrap" }}
                      >
                        Restore default
                      </button>
                      <button
                        className="ns-btn"
                        type="button"
                        onClick={saveShellCommand}
                        disabled={shellRunning || !shellCommand.trim()}
                        title="Save the command text"
                        style={{ ...btnLikeStyle, opacity: shellRunning || !shellCommand.trim() ? 0.55 : 1, whiteSpace: "nowrap" }}
                      >
                        Save command
                      </button>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--accent)", lineHeight: "20px" }}>$</span>
                    <textarea
                      value={shellCommand}
                      onChange={(e) => { setShellCommand(e.target.value); setShellCommandSaved(false); }}
                      spellCheck={false}
                      rows={4}
                      aria-label="Shell command"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        resize: "vertical",
                        border: "none",
                        outline: "none",
                        background: "transparent",
                        color: "var(--text)",
                        fontFamily: "var(--font-mono)",
                        fontSize: 12,
                        lineHeight: 1.45,
                      }}
                    />
                  </div>
                </div>
                {shellError && <div style={{ flexShrink: 0, padding: "6px 12px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "#ef4444" }}>{shellError}</div>}
                {shellExit && <div style={{ flexShrink: 0, padding: "6px 12px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--text-dim)" }}>Last exit: code={shellExit.code ?? "null"} signal={shellExit.signal ?? "null"}</div>}
                <pre
                  ref={shellOutputRef}
                  aria-label="Shell output"
                  style={{
                    flex: 1,
                    minHeight: 0,
                    margin: 0,
                    overflow: "auto",
                    padding: 12,
                    background: "var(--bg)",
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    lineHeight: 1.5,
                    whiteSpace: "pre-wrap",
                  }}
                >{shellOutput || "No command has run yet."}</pre>
              </div>
            )}
          </div>
        </aside>
        )}
      </div>

    </div>
  );
}

const headerIconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 26,
  padding: 0,
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg-panel)",
  color: "var(--text)",
  cursor: "pointer",
  flexShrink: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  transition: "background 140ms ease, border-color 140ms ease, color 140ms ease",
};

const btnLikeStyle: React.CSSProperties = {
  height: 28,
  padding: "0 12px",
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg-panel)",
  color: "var(--text)",
  cursor: "pointer",
  fontSize: 12,
};
