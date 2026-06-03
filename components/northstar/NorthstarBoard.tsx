"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  NorthstarBoard as NorthstarBoardModel,
  NorthstarBoardCard,
  NorthstarLifecycleState,
  NorthstarProjectSummary,
} from "@/lib/northstar/types";

import { IssueDrawer } from "./IssueDrawer";

const LIFECYCLE_ORDER: NorthstarLifecycleState[] = [
  "ready", "claimed", "running", "verifying", "verified",
  "release_pending", "completed", "cancelled", "failed", "quarantined",
];

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

const centeredStyle: React.CSSProperties = {
  height: "100%", display: "flex", alignItems: "center", justifyContent: "center",
  padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6,
};

interface CardProps {
  card: NorthstarBoardCard;
  onClick: () => void;
}

function BoardCard({ card, onClick }: CardProps) {
  const problem = isProblem(card);
  const issueLabel = card.issueNumber ? `#${card.issueNumber}` : card.issueId;

  return (
    <article
      onClick={onClick}
      style={{
        border: `1px solid ${problem === "red" ? "#ef4444" : problem === "orange" ? "#d97706" : "var(--border)"}`,
        borderRadius: 6, background: "var(--bg)", color: "var(--text)",
        padding: 10, minWidth: 0, boxSizing: "border-box", cursor: "pointer",
        boxShadow: problem ? `0 0 0 1px ${problem === "red" ? "#ef444433" : "#d9770633"}` : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <span style={{ color: "var(--text-muted)", fontSize: 11, flexShrink: 0 }}>{issueLabel}</span>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: statusDotColor(card), flexShrink: 0 }} />
        {problem && <span style={{ fontSize: 11 }}>⚠</span>}
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
      {card.prUrl && (
        <a href={card.prUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}
          style={{ display: "inline-block", marginTop: 5, fontSize: 11, color: "var(--accent)", textDecoration: "none" }}>
          View PR ↗
        </a>
      )}
    </article>
  );
}

interface ColumnProps {
  lifecycle: NorthstarLifecycleState;
  cards: NorthstarBoardCard[];
  initiallyCollapsed: boolean;
  onCardClick: (card: NorthstarBoardCard) => void;
}

function Column({ lifecycle, cards, initiallyCollapsed, onCardClick }: ColumnProps) {
  const [collapsed, setCollapsed] = useState(initiallyCollapsed);
  useEffect(() => {
    if (!initiallyCollapsed) setCollapsed(false);
  }, [initiallyCollapsed]);
  const label = lifecycle.replace(/_/g, " ");
  const sorted = sortedCards(cards);

  if (collapsed) {
    return (
      <div
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", borderBottom: "1px solid var(--border)", cursor: "pointer", flexShrink: 0 }}
        onClick={() => setCollapsed(true)}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textTransform: "capitalize" }}>{label}</span>
        <span style={{ color: "var(--text-muted)", fontSize: 11 }}>{cards.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8, overflow: "auto" }}>
        {sorted.length === 0
          ? <div style={{ fontSize: 12, color: "var(--text-dim)", padding: "4px 2px" }}>No issues</div>
          : sorted.map((card) => <BoardCard key={card.issueId} card={card} onClick={() => onCardClick(card)} />)
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

  useEffect(() => { void load(configPath); }, [configPath, load]);

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

  // Warning bar counts
  const allCards = board.groups.flatMap((g) => g.cards);
  const redCount = allCards.filter((c) => c.lifecycle === "quarantined" || c.lifecycle === "failed").length;
  const orangeCount = allCards.filter((c) => (c.blocked || c.projectionFailure) && c.lifecycle !== "quarantined" && c.lifecycle !== "failed").length;
  const problemCount = redCount + orangeCount;

  // Build a map for quick lookup
  const cardsByLifecycle = new Map(board.groups.map((g) => [g.lifecycle, g.cards]));

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: "1px solid var(--border)", background: "var(--bg)", flexShrink: 0, minWidth: 0 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 650, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{board.project.name}</div>
          <div style={{ display: "flex", gap: 10, marginTop: 2, color: "var(--text-muted)", fontSize: 12 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{board.project.repo}</span>
            <span style={{ flexShrink: 0 }}>host: {board.project.hostAdapter}</span>
          </div>
        </div>
        <button type="button" onClick={() => void load(configPath)} style={{ padding: "4px 10px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 5, background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer", flexShrink: 0 }}>
          ↺
        </button>
      </div>

      {/* Warning bar */}
      {problemCount > 0 && (
        <div style={{ padding: "6px 14px", background: "#7c1d1d22", borderBottom: "1px solid #ef444433", fontSize: 12, color: "#ef4444", flexShrink: 0 }}>
          ⚠ {problemCount} issue{problemCount > 1 ? "s" : ""} need attention:
          {redCount > 0 && ` quarantined/failed ×${redCount}`}
          {orangeCount > 0 && ` blocked ×${orangeCount}`}
        </div>
      )}

      {/* Columns */}
      <div style={{ flex: 1, overflow: "auto", padding: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
        {LIFECYCLE_ORDER.map((lifecycle) => {
          const cards = cardsByLifecycle.get(lifecycle) ?? [];
          return (
            <Column
              key={lifecycle}
              lifecycle={lifecycle}
              cards={cards}
              initiallyCollapsed={cards.length === 0}
              onCardClick={setActiveCard}
            />
          );
        })}
      </div>

      {/* Drawer */}
      {activeCard && (
        <IssueDrawer
          card={activeCard}
          projectId={board.project.projectId}
          configPath={configPath}
          onClose={() => setActiveCard(null)}
        />
      )}
    </div>
  );
}
