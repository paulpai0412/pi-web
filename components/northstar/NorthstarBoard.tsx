"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  NorthstarBoard as NorthstarBoardModel,
  NorthstarBoardCard,
  NorthstarProjectSummary,
} from "@/lib/northstar/types";

// Self-contained, read-only Northstar board. Fetches the existing
// /api/northstar routes (which proxy to the real Northstar install) and renders
// a lifecycle kanban. Deliberately has NO wizard/assistant tabs and NO per-card
// action buttons — see docs/northstar-integration.md.

function apiPath(path: string, configPath: string): string {
  return `${path}?config=${encodeURIComponent(configPath)}`;
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? `Northstar request failed with ${response.status}`);
  }
  return payload;
}

function lifecycleLabel(value: string): string {
  return value.replaceAll("_", " ");
}

function issueLabel(card: NorthstarBoardCard): string {
  return card.issueNumber ? `#${card.issueNumber}` : card.issueId;
}

function statusColor(card: NorthstarBoardCard): string {
  if (card.projectionFailure || card.blocked) return "#ef4444";
  if (card.lifecycle === "completed") return "#16a34a";
  if (card.lifecycle === "failed" || card.lifecycle === "quarantined") return "#d97706";
  return "var(--accent)";
}

const pillStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  border: "1px solid var(--border)",
  borderRadius: 4,
  padding: "1px 6px",
  fontSize: 11,
  color: "var(--text-muted)",
  whiteSpace: "nowrap",
};

const centeredStyle: React.CSSProperties = {
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  textAlign: "center",
  color: "var(--text-muted)",
  fontSize: 13,
  lineHeight: 1.6,
};

export function NorthstarBoard({ configPath }: { configPath: string | null }) {
  const [board, setBoard] = useState<NorthstarBoardModel | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextConfigPath: string | null) => {
    if (!nextConfigPath) {
      setBoard(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { projects } = await readJson<{ projects: NorthstarProjectSummary[] }>(
        apiPath("/api/northstar/projects", nextConfigPath),
      );
      const project = projects[0];
      if (!project) {
        setBoard(null);
        setError("No Northstar project found for this config.");
        return;
      }
      const { board: boardPayload } = await readJson<{ board: NorthstarBoardModel }>(
        apiPath(`/api/northstar/projects/${encodeURIComponent(project.projectId)}`, nextConfigPath),
      );
      setBoard(boardPayload);
    } catch (err) {
      setBoard(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(configPath);
  }, [configPath, load]);

  if (!configPath) {
    return (
      <div style={centeredStyle}>
        Select a project directory with a <code>.northstar.yaml</code> file to view its Northstar board.
      </div>
    );
  }

  if (loading && !board) {
    return <div style={centeredStyle}>Loading Northstar board…</div>;
  }

  if (error) {
    return (
      <div style={centeredStyle}>
        <div>
          <div style={{ color: "var(--text)", fontWeight: 600, marginBottom: 6 }}>Couldn’t load the Northstar board</div>
          <div style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", whiteSpace: "pre-wrap" }}>{error}</div>
          <button
            type="button"
            onClick={() => void load(configPath)}
            style={{
              marginTop: 12, padding: "5px 12px", fontSize: 12,
              border: "1px solid var(--border)", borderRadius: 5,
              background: "var(--bg-panel)", color: "var(--text)", cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!board) {
    return <div style={centeredStyle}>No Northstar board loaded.</div>;
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minWidth: 0 }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "12px 14px", borderBottom: "1px solid var(--border)",
          background: "var(--bg)", flexShrink: 0, minWidth: 0,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 650, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {board.project.name}
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 3, color: "var(--text-muted)", fontSize: 12, minWidth: 0 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{board.project.repo}</span>
            <span style={{ flexShrink: 0 }}>host: {board.project.hostAdapter}</span>
          </div>
        </div>
      </div>

      <div
        style={{
          flex: 1, overflow: "auto", padding: 12,
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          alignItems: "start", gap: 12, background: "var(--bg-panel)",
        }}
      >
        {board.groups.map((group) => (
          <section
            key={group.lifecycle}
            style={{
              display: "flex", flexDirection: "column", minWidth: 0,
              border: "1px solid var(--border)", borderRadius: 6,
              background: "var(--bg)", maxHeight: "100%",
            }}
          >
            <div
              style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                gap: 8, padding: "9px 10px", borderBottom: "1px solid var(--border)", minHeight: 36,
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", textTransform: "capitalize" }}>
                {lifecycleLabel(group.lifecycle)}
              </span>
              <span style={{ color: "var(--text-muted)", fontSize: 11, fontVariantNumeric: "tabular-nums" }}>
                {group.cards.length}
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8, overflow: "auto" }}>
              {group.cards.length === 0 ? (
                <div style={{ color: "var(--text-dim)", fontSize: 12, padding: "8px 2px" }}>No issues</div>
              ) : (
                group.cards.map((card) => (
                  <article
                    key={card.issueId}
                    style={{
                      border: "1px solid var(--border)", borderRadius: 6,
                      background: "var(--bg)", color: "var(--text)", padding: 10,
                      minWidth: 0, boxSizing: "border-box",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <span style={{ color: "var(--text-muted)", fontSize: 11, fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
                        {issueLabel(card)}
                      </span>
                      <span style={{ width: 7, height: 7, borderRadius: 999, background: statusColor(card), flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13, fontWeight: 600 }}>
                        {card.title}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 9, minWidth: 0 }}>
                      <span style={pillStyle}>{card.currentStage ?? "no stage"}</span>
                      <span style={pillStyle}>host {card.latestHostAdapter ?? "none"}</span>
                      <span style={pillStyle}>deps {card.dependencyCount}</span>
                      {card.projectionFailure && <span style={{ ...pillStyle, color: "#ef4444", borderColor: "#ef4444" }}>projection</span>}
                      {card.blocked && <span style={{ ...pillStyle, color: "#ef4444", borderColor: "#ef4444" }}>blocked</span>}
                    </div>
                    <div style={{ marginTop: 7, color: "var(--text-muted)", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      next: {card.nextRecommendedAction}
                    </div>
                    {card.prUrl && (
                      <a
                        href={card.prUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{ display: "inline-block", marginTop: 7, fontSize: 12, color: "var(--accent)", textDecoration: "none" }}
                      >
                        View PR ↗
                      </a>
                    )}
                  </article>
                ))
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
