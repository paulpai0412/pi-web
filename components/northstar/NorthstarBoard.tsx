"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  NorthstarBoard as NorthstarBoardModel,
  NorthstarBoardCard,
  NorthstarLifecycleState,
  NorthstarProjectSummary,
} from "@/lib/northstar/types";

import { IssueDrawer } from "./IssueDrawer";
import { IssueSseModal } from "./IssueSseModal";
import { WatchSsePanel } from "./WatchSsePanel";

const LIFECYCLE_ORDER: NorthstarLifecycleState[] = [
  "ready", "claimed", "running", "verifying", "verified",
  "release_pending", "exception", "completed", "cancelled", "failed", "quarantined",
];

const PENDING_STATES: NorthstarLifecycleState[] = [
  "ready",
  "claimed",
  "running",
  "verifying",
  "verified",
  "release_pending",
  "exception",
];

const CONFIG_SUFFIX = "/.northstar.yaml";

const DEFAULT_WATCH_PROMPT = [
  "請啟動 northstar skill watch，持續推進目前專案待處理 issue。",
  "規則：持續循環執行直到我明確要求停止，或已無待處理 issue（ready/claimed/running/verifying/verified/release_pending/exception 皆為 0）。",
  "每輪請簡短回報目前進度、卡住原因與下一步。",
].join("\n");

const STOP_WATCH_PROMPT = "請停止 northstar watch，結束本輪執行並回報停止結果。";

function apiPath(path: string, configPath: string) {
  return `${path}?config=${encodeURIComponent(configPath)}`;
}

async function readJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const payload = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(payload.error ?? `Northstar request failed with ${res.status}`);
  return payload;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(payload.error ?? `Request failed with ${res.status}`);
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

function configToCwd(configPath: string): string {
  return configPath.endsWith(CONFIG_SUFFIX)
    ? configPath.slice(0, -CONFIG_SUFFIX.length)
    : configPath;
}

const centeredStyle: React.CSSProperties = {
  height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
  padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6,
};

const iconStroke: React.CSSProperties = { width: 14, height: 14, display: "block" };

function RefreshIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={iconStroke}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

function StartIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={iconStroke}>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" style={iconStroke}>
      <rect x="6" y="6" width="12" height="12" rx="1.5" />
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
  onClick: () => void;
  onOpenSse: () => void;
}

function BoardCard({ card, repo, onClick, onOpenSse }: CardProps) {
  const problem = isProblem(card);
  const issueLabel = card.issueNumber ? `#${card.issueNumber}` : card.issueId;
  const issueUrl = card.issueNumber ? `https://github.com/${repo}/issues/${card.issueNumber}` : null;

  return (
    <article
      className="ns-surface-interactive"
      onClick={onClick}
      style={{
        border: "1px solid var(--border)",
        borderRadius: 6, background: "var(--bg)", color: "var(--text)",
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
}

function Column({ lifecycle, cards, repo, initiallyCollapsed, onCardClick, onOpenSse }: ColumnProps) {
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
    <section style={{ display: "flex", flexDirection: "column", minWidth: 220, maxWidth: 280, flex: "1 1 220px", border: "1px solid var(--border)", borderRadius: 6, background: "var(--bg)", maxHeight: "100%" }}>
      <div className="ns-surface-interactive" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderBottom: "1px solid var(--border)", cursor: "pointer", flexShrink: 0 }}
        onClick={() => setCollapsed(true)}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textTransform: "capitalize" }}>{label}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{cards.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8, overflow: "auto" }}>
        {sorted.length === 0
          ? <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "4px 2px" }}>No issues</div>
          : sorted.map((card) => (
            <BoardCard
              key={card.issueId}
              card={card}
              repo={repo}
              onClick={() => onCardClick(card)}
              onOpenSse={() => onOpenSse(card)}
            />
          ))
        }
      </div>
    </section>
  );
}

export function NorthstarBoard({ configPath }: { configPath: string | null }) {
  const [board, setBoard] = useState<NorthstarBoardModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeCard, setActiveCard] = useState<NorthstarBoardCard | null>(null);

  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [watchSessionId, setWatchSessionId] = useState<string | null>(null);
  const [watchActive, setWatchActive] = useState(false);
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchError, setWatchError] = useState<string | null>(null);
  const [watchPanelOpen, setWatchPanelOpen] = useState(false);
  const [watchPanelHeight, setWatchPanelHeight] = useState(220);

  const [sseModalCard, setSseModalCard] = useState<NorthstarBoardCard | null>(null);

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

  const stopWatch = useCallback(async (reason: "manual" | "auto") => {
    if (!watchSessionId) return;

    setWatchBusy(true);
    setWatchError(null);

    try {
      await postJson(`/api/agent/${encodeURIComponent(watchSessionId)}`, { type: "abort" });
    } catch {
      // continue; prompt may still stop the session cleanly
    }

    try {
      const stopMessage = reason === "auto"
        ? `${STOP_WATCH_PROMPT}\n\n原因：目前 board 無待處理 issue。`
        : STOP_WATCH_PROMPT;
      await postJson(`/api/agent/${encodeURIComponent(watchSessionId)}`, { type: "prompt", message: stopMessage });
      setWatchActive(false);
    } catch (e) {
      setWatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setWatchBusy(false);
    }
  }, [watchSessionId]);

  const startWatch = useCallback(async () => {
    if (!configPath) return;
    setWatchBusy(true);
    setWatchError(null);

    try {
      const cwd = configToCwd(configPath);
      const payload = await postJson<{ success: boolean; sessionId: string }>("/api/agent/new", {
        cwd,
        type: "prompt",
        message: DEFAULT_WATCH_PROMPT,
      });
      setWatchSessionId(payload.sessionId);
      setWatchActive(true);
      setWatchPanelOpen(true);
    } catch (e) {
      setWatchError(e instanceof Error ? e.message : String(e));
    } finally {
      setWatchBusy(false);
    }
  }, [configPath]);

  useEffect(() => {
    void load(configPath);
  }, [configPath, load]);

  useEffect(() => {
    if (!autoRefreshEnabled || !configPath) return;
    const timer = setInterval(() => {
      void load(configPath);
    }, 60 * 1000);
    return () => clearInterval(timer);
  }, [autoRefreshEnabled, configPath, load]);

  const pendingCount = useMemo(() => (board ? countPending(board) : 0), [board]);

  useEffect(() => {
    if (!watchActive || !watchSessionId || watchBusy) return;
    if (pendingCount !== 0) return;
    void stopWatch("auto");
  }, [pendingCount, stopWatch, watchActive, watchBusy, watchSessionId]);

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

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg)", flexShrink: 0, minWidth: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 650, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{board.project.name}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 2, color: "var(--text-muted)", fontSize: 12 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{board.project.repo}</span>
            <span style={{ flexShrink: 0 }}>host: {board.project.hostAdapter}</span>
          </div>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--text-muted)" }}>
              <input
                type="checkbox"
                checked={autoRefreshEnabled}
                onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
                style={{ accentColor: "var(--accent)" }}
              />
              Auto refresh (60s)
            </label>
            <span style={{ fontSize: 11, color: watchActive ? "#16a34a" : "var(--text-dim)" }}>
              watch: {watchActive ? "running" : "stopped"}
            </span>
            <span style={{ fontSize: 11, color: "var(--text-dim)" }}>pending: {pendingCount}</span>
          </div>
          {watchError && <div style={{ marginTop: 6, fontSize: 11, color: "#ef4444" }}>{watchError}</div>}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          <button className="ns-btn" type="button" title="Refresh" aria-label="Refresh" onClick={() => void load(configPath)} style={headerIconButtonStyle}><RefreshIcon /></button>
          {!watchActive ? (
            <button className="ns-btn" type="button" title="Start watch" aria-label="Start watch" onClick={() => void startWatch()} disabled={watchBusy} style={{ ...headerIconButtonStyle, opacity: watchBusy ? 0.6 : 1 }}>
              <StartIcon />
            </button>
          ) : (
            <button className="ns-btn" type="button" title="Stop watch" aria-label="Stop watch" onClick={() => void stopWatch("manual")} disabled={watchBusy || !watchSessionId} style={{ ...headerIconButtonStyle, opacity: watchBusy ? 0.6 : 1 }}>
              <StopIcon />
            </button>
          )}
          <button className="ns-btn" type="button" title={watchPanelOpen ? "Hide SSE" : "Show SSE"} aria-label={watchPanelOpen ? "Hide SSE" : "Show SSE"} onClick={() => setWatchPanelOpen((v) => !v)} style={headerIconButtonStyle}>
            <StreamIcon />
          </button>
        </div>
      </div>

      {problemCount > 0 && (
        <div style={{ padding: "6px 14px", background: "#7c1d1d22", borderBottom: "1px solid #ef444433", fontSize: 12, color: "#ef4444", flexShrink: 0 }}>
          ⚠ {problemCount} issue{problemCount > 1 ? "s" : ""} need attention:
          {redCount > 0 && ` quarantined/failed ×${redCount}`}
          {orangeCount > 0 && ` blocked ×${orangeCount}`}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
        {LIFECYCLE_ORDER.filter((lifecycle) => (cardsByLifecycle.get(lifecycle) ?? []).length > 0).map((lifecycle) => {
          const cards = cardsByLifecycle.get(lifecycle) ?? [];
          return (
            <Column
              key={lifecycle}
              lifecycle={lifecycle}
              cards={cards}
              repo={board.project.repo}
              initiallyCollapsed={false}
              onCardClick={setActiveCard}
              onOpenSse={setSseModalCard}
            />
          );
        })}
        {LIFECYCLE_ORDER.every((lifecycle) => (cardsByLifecycle.get(lifecycle) ?? []).length === 0) && (
          <div style={{ fontSize: 12, color: "var(--text-dim)", padding: 6 }}>No issues on the board.</div>
        )}
      </div>

      {watchPanelOpen && (
        <WatchSsePanel
          sessionId={watchSessionId}
          height={watchPanelHeight}
          onHeightChange={setWatchPanelHeight}
          onClose={() => setWatchPanelOpen(false)}
          onSessionEnded={() => setWatchActive(false)}
        />
      )}

      {activeCard && (
        <IssueDrawer
          card={activeCard}
          projectId={board.project.projectId}
          configPath={configPath}
          onClose={() => setActiveCard(null)}
        />
      )}

      <IssueSseModal card={sseModalCard} onClose={() => setSseModalCard(null)} />
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
