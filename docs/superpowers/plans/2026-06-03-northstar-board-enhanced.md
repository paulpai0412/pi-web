# Northstar Board Enhanced Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the Northstar board from a read-only kanban into a full operator dashboard with horizontal lifecycle columns, per-card problem highlighting, a right-side detail drawer with live streaming, and action buttons that directly execute northstar CLI commands via `tsx`.

**Architecture:** Five independent layers built bottom-up: (1) backend data — expose `getIssue`/`listIssueEvents` via the existing webpack-bundled SQLite loader; (2) backend execution — a new SSE route that spawns the northstar CLI with `tsx` and streams its stdout/stderr; (3) `useIssueStream` hook — normalises three streaming sources (CLI run, pi agent SSE, history poll); (4) `IssueDrawer` — right-side panel consuming the hook; (5) `NorthstarBoard` rewrite — horizontal columns, collapsing, highlights, drawer wiring.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, Node.js `child_process.spawn`, EventSource API, SQLite via `@northstar/runtime` read-model, `tsx` (TypeScript executor installed in `apps/northstar`)

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `lib/northstar/local-api-loader.js` | Modify | Add `getIssue` + `listIssueEvents` using SQLite store |
| `app/api/northstar/projects/[projectId]/issues/[issueId]/run/route.ts` | Create | SSE endpoint: spawns tsx + northstar CLI, pipes stdout/stderr |
| `components/northstar/useIssueStream.ts` | Create | Hook: three-mode streaming (CLI run / pi SSE / history poll) |
| `components/northstar/IssueDrawer.tsx` | Create | Right-side drawer: detail, actions, live stream, history |
| `components/northstar/NorthstarBoard.tsx` | Rewrite | Horizontal columns, collapse, warning bar, highlight, drawer |

---

## Task 1: local-api-loader.js — add getIssue + listIssueEvents

**Files:**
- Modify: `lib/northstar/local-api-loader.js`

The `buildNorthstarIssueDetail` and `runEventForHistory` functions live in the same
bundle-clean closure already imported. All their transitive deps use only relative imports
and `node:` builtins — safe for webpack.

- [ ] **Step 1: Add imports at the top of `lib/northstar/local-api-loader.js`**

After the existing `import { buildNorthstarBoard }` line, add:

```js
import { buildNorthstarIssueDetail, runEventForHistory } from "../../../northstar/src/operator-dashboard/read-model.ts";
```

- [ ] **Step 2: Implement `getIssue` and `listIssueEvents` in the returned object**

Replace the two `unsupported` stubs:

```js
// Before (lines to remove):
getIssue: unsupported("getIssue"),
listIssueEvents: unsupported("listIssueEvents"),

// After:
getIssue(issueId) {
  const config = readConfig();
  return readWithStore(config, (store) => {
    const snapshot = store.getIssue(issueId);
    const history = store.listHistory(issueId);
    return buildNorthstarIssueDetail({
      project: projectSummaryForConfig(config, input.configPath),
      snapshot,
      history,
      now: new Date().toISOString(),
    });
  });
},
listIssueEvents(issueId) {
  const config = readConfig();
  return readWithStore(config, (store) => {
    return store.listHistory(issueId).map(runEventForHistory);
  });
},
```

- [ ] **Step 3: Typecheck and lint**

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

Expected: zero errors. If `tsc` flags the `.js` file, ignore — it's intentionally plain JS
(webpack handles TS imports from it).

- [ ] **Step 4: Commit**

```bash
git add lib/northstar/local-api-loader.js
git commit -m "feat(northstar): implement getIssue and listIssueEvents in local-api-loader"
```

---

## Task 2: /run SSE route — spawn northstar CLI

**Files:**
- Create: `app/api/northstar/projects/[projectId]/issues/[issueId]/run/route.ts`

This route spawns `tsx src/cli/entrypoint.ts <action> --issue <issueId> --config <config>`
from the northstar root and streams each stdout/stderr line as an SSE event. The
`NORTHSTAR_ROOT` env var selects the install; defaults to the known local path.

- [ ] **Step 1: Create the route file**

```typescript
import { spawn } from "child_process";
import { resolve } from "path";

export const dynamic = "force-dynamic";

const NORTHSTAR_ROOT =
  process.env.NORTHSTAR_ROOT ?? "/home/timmypai/apps/northstar";

const VALID_ACTIONS = [
  "start",
  "reconcile",
  "release",
  "repair-runtime",
  "retry-sync",
] as const;

type ValidAction = (typeof VALID_ACTIONS)[number];

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; issueId: string }> }
) {
  const { issueId } = await params;
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const config = url.searchParams.get("config");

  if (!action || !(VALID_ACTIONS as readonly string[]).includes(action)) {
    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!config) {
    return new Response(JSON.stringify({ error: "config is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tsx = resolve(NORTHSTAR_ROOT, "node_modules/.bin/tsx");
  const entrypoint = resolve(NORTHSTAR_ROOT, "src/cli/entrypoint.ts");
  const cliArgs = [
    entrypoint,
    action as ValidAction,
    "--issue",
    issueId,
    "--config",
    resolve(config),
  ];

  let child: ReturnType<typeof spawn> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      child = spawn(tsx, cliArgs, { cwd: NORTHSTAR_ROOT });

      child.stdout.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) encode({ type: "line", stream: "stdout", text: line });
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) encode({ type: "line", stream: "stderr", text: line });
        }
      });

      child.on("close", (code) => {
        encode({ type: "exit", code: code ?? 1 });
        controller.close();
      });

      child.on("error", (err) => {
        encode({ type: "error", message: err.message });
        controller.close();
      });
    },
    cancel() {
      child?.kill();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add app/api/northstar/projects/\[projectId\]/issues/\[issueId\]/run/route.ts
git commit -m "feat(northstar): add /run SSE route for direct CLI execution via tsx"
```

---

## Task 3: useIssueStream — three-mode streaming hook

**Files:**
- Create: `components/northstar/useIssueStream.ts`

This hook normalises the three sources (CLI run SSE, pi agent SSE, SQLite history poll)
into a single `StreamLine[]` list. The caller decides the mode; the hook owns the
connection lifecycle.

- [ ] **Step 1: Create `components/northstar/useIssueStream.ts`**

```typescript
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { NorthstarRunEvent } from "@/lib/northstar/types";

export interface StreamLine {
  id: string;
  text: string;
  severity?: "info" | "warning" | "error";
  timestamp?: string;
  isStderr?: boolean;
}

export type StreamMode =
  | { type: "run"; url: string }           // CLI via /run SSE
  | { type: "pi"; sessionId: string }      // pi agent /api/agent/{id}/events
  | { type: "poll"; eventsUrl: string }    // SQLite history poll
  | { type: "idle" };

// Stable key derived from mode so useEffect doesn't fire on every render
function modeKey(mode: StreamMode): string {
  if (mode.type === "run") return `run:${mode.url}`;
  if (mode.type === "pi") return `pi:${mode.sessionId}`;
  if (mode.type === "poll") return `poll:${mode.eventsUrl}`;
  return "idle";
}

export function useIssueStream(mode: StreamMode) {
  const [lines, setLines] = useState<StreamLine[]>([]);
  const [isLive, setIsLive] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const seqRef = useRef(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const modeKeyValue = modeKey(mode);

  const push = useCallback((line: StreamLine) => {
    setLines((prev) => [...prev, line]);
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setLines([]);
    setIsLive(false);
    setExitCode(null);
    seqRef.current = 0;
    esRef.current?.close();
    if (pollRef.current) clearInterval(pollRef.current);

    if (mode.type === "idle") return;

    if (mode.type === "run") {
      const es = new EventSource(mode.url);
      esRef.current = es;
      setIsLive(true);

      es.onmessage = (e) => {
        const data = JSON.parse(e.data as string) as {
          type: string;
          text?: string;
          stream?: "stdout" | "stderr";
          code?: number;
          message?: string;
        };
        if (data.type === "line" && data.text) {
          push({
            id: `run-${Date.now()}-${Math.random()}`,
            text: data.text,
            isStderr: data.stream === "stderr",
          });
        } else if (data.type === "exit") {
          setExitCode(data.code ?? 0);
          setIsLive(false);
          es.close();
        } else if (data.type === "error") {
          push({ id: `err-${Date.now()}`, text: data.message ?? "error", isStderr: true });
          setIsLive(false);
          es.close();
        }
      };

      es.onerror = () => {
        setIsLive(false);
        es.close();
      };

      return () => {
        es.close();
        setIsLive(false);
      };
    }

    if (mode.type === "pi") {
      const url = `/api/agent/${encodeURIComponent(mode.sessionId)}/events`;
      const es = new EventSource(url);
      esRef.current = es;
      setIsLive(true);

      es.onmessage = (e) => {
        const event = JSON.parse(e.data as string) as { type: string; [k: string]: unknown };
        let text: string | null = null;

        if (event.type === "text_delta" && typeof event.delta === "string") {
          text = event.delta;
        } else if (event.type === "agent_end") {
          setIsLive(false);
          es.close();
          return;
        } else if (event.type === "connected") {
          return;
        } else {
          text = event.type;
        }

        if (text) {
          push({ id: `pi-${Date.now()}-${Math.random()}`, text });
        }
      };

      es.onerror = () => {
        setIsLive(false);
        es.close();
      };

      return () => {
        es.close();
        setIsLive(false);
      };
    }

    if (mode.type === "poll") {
      setIsLive(true);

      const fetchEvents = async () => {
        try {
          const res = await fetch(mode.eventsUrl);
          if (!res.ok) return;
          const { events } = (await res.json()) as { events: NorthstarRunEvent[] };
          const newEvents = events.filter((e) => e.sequence > seqRef.current);
          if (newEvents.length > 0) {
            seqRef.current = Math.max(...newEvents.map((e) => e.sequence));
            for (const e of newEvents) {
              push({
                id: e.id,
                text: e.summary,
                severity: e.severity,
                timestamp: e.createdAt ?? undefined,
              });
            }
          }
        } catch {
          // swallow — poll will retry
        }
      };

      void fetchEvents();
      pollRef.current = setInterval(() => void fetchEvents(), 2000);

      return () => {
        if (pollRef.current) clearInterval(pollRef.current);
        setIsLive(false);
      };
    }
  // Use modeKeyValue (string) instead of mode (object) to avoid infinite-loop
  // from object-identity changes on each render.
  }, [modeKeyValue, push]); // eslint-disable-line react-hooks/exhaustive-deps

  return { lines, isLive, exitCode };
}
```

- [ ] **Step 2: Typecheck**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add components/northstar/useIssueStream.ts
git commit -m "feat(northstar): add useIssueStream hook with run/pi/poll modes"
```

---

## Task 4: IssueDrawer component

**Files:**
- Create: `components/northstar/IssueDrawer.tsx`

Right-side slide-in drawer. On open it fetches the issue detail (`/api/northstar/.../issues/{id}`).
Action buttons trigger the `/run` SSE endpoint and switch the stream mode to `"run"`.
When no action is running, displays the worker's existing session stream (pi SSE or history poll)
based on `card.latestHostAdapter`.

- [ ] **Step 1: Create `components/northstar/IssueDrawer.tsx`**

```typescript
"use client";

import { useCallback, useEffect, useState } from "react";

import type {
  NorthstarBoardCard,
  NorthstarIssueDetail,
  NorthstarLifecycleState,
} from "@/lib/northstar/types";

import { useIssueStream, type StreamMode } from "./useIssueStream";

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

function defaultMode(card: NorthstarBoardCard, projectId: string, configPath: string): StreamMode {
  if (card.latestRootSessionId && card.latestHostAdapter === "pi") {
    return { type: "pi", sessionId: card.latestRootSessionId };
  }
  if (
    card.latestRootSessionId &&
    (card.lifecycle === "running" || card.lifecycle === "verifying" || card.lifecycle === "claimed")
  ) {
    const eventsUrl = `/api/northstar/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(card.issueId)}/events?config=${encodeURIComponent(configPath)}`;
    return { type: "poll", eventsUrl };
  }
  return { type: "idle" };
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

const btnStyle: React.CSSProperties = {
  padding: "5px 12px",
  fontSize: 12,
  border: "1px solid var(--border)",
  borderRadius: 5,
  background: "var(--bg-panel)",
  color: "var(--text)",
  cursor: "pointer",
  marginRight: 6,
};

export function IssueDrawer({ card, projectId, configPath, onClose }: Props) {
  const [detail, setDetail] = useState<NorthstarIssueDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [streamMode, setStreamMode] = useState<StreamMode>({ type: "idle" });
  const [snapshotOpen, setSnapshotOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);

  const { lines, isLive, exitCode } = useIssueStream(streamMode);

  useEffect(() => {
    if (!card) {
      setDetail(null);
      setDetailError(null);
      setStreamMode({ type: "idle" });
      return;
    }
    setDetail(null);
    setDetailError(null);
    // Compute mode inside effect to avoid object-identity churn on each render
    setStreamMode(defaultMode(card, projectId, configPath));

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
      if (!card) return;
      const url = `/api/northstar/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(card.issueId)}/run?action=${encodeURIComponent(command)}&config=${encodeURIComponent(configPath)}`;
      setStreamMode({ type: "run", url });
    },
    [card, projectId, configPath]
  );

  if (!card) return null;

  const actions = actionsForCard(card);
  const issueLabel = card.issueNumber ? `#${card.issueNumber}` : card.issueId;

  return (
    <div style={drawerStyle}>
      {/* Header */}
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
        <button type="button" onClick={onClose} style={{ ...btnStyle, flexShrink: 0, marginRight: 0 }}>✕</button>
      </div>

      {/* Actions */}
      {actions.length > 0 && (
        <div style={sectionStyle}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: 1 }}>
            Actions
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {actions.map((action) => (
              <button
                key={action.command}
                type="button"
                onClick={() => runAction(action.command)}
                disabled={isLive}
                style={{ ...btnStyle, opacity: isLive ? 0.5 : 1 }}
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
        </div>
      )}

      {/* Scrollable content */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {/* Live stream */}
        {(lines.length > 0 || isLive) && (
          <div style={{ ...sectionStyle, borderBottom: "1px solid var(--border)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>
              {isLive ? "Live stream ●" : exitCode !== null ? `Stream (exit ${exitCode})` : "Stream"}
            </div>
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, maxHeight: 280, overflow: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
              {lines.map((line) => (
                <div key={line.id} style={{ color: line.isStderr || line.severity === "error" ? "#ef4444" : line.severity === "warning" ? "#d97706" : "var(--text-muted)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {line.timestamp ? <span style={{ opacity: 0.5, marginRight: 6 }}>{line.timestamp.slice(11, 19)}</span> : null}
                  {line.text}
                </div>
              ))}
              {isLive && <div style={{ color: "var(--accent)" }}>▋</div>}
            </div>
          </div>
        )}

        {/* Snapshot */}
        <div style={sectionStyle}>
          <button
            type="button"
            onClick={() => setSnapshotOpen((v) => !v)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, padding: 0 }}
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

        {/* History */}
        <div style={sectionStyle}>
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, padding: 0 }}
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
```

- [ ] **Step 2: Typecheck**

```bash
node_modules/.bin/tsc --noEmit
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add components/northstar/IssueDrawer.tsx
git commit -m "feat(northstar): add IssueDrawer with live stream, snapshot, history, actions"
```

---

## Task 5: NorthstarBoard rewrite

**Files:**
- Rewrite: `components/northstar/NorthstarBoard.tsx`

Full replacement. Key behaviours:
- Fixed column order matching `NorthstarLifecycleState` (ready → claimed → running → verifying → verified → release_pending → completed → cancelled → failed → quarantined).
- Empty columns start collapsed (thin strip, click to expand). Columns with cards start expanded.
- Problem cards (`quarantined`/`failed` = red, `blocked`/`projectionFailure` = orange) sorted to top of their column.
- Warning bar above columns: "⚠ N issues need attention: quarantined ×N …"
- Click card → opens `IssueDrawer`.

- [ ] **Step 1: Replace `components/northstar/NorthstarBoard.tsx` entirely**

```typescript
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
        <div style={{ color: "var(--text)", fontWeight: 600, marginBottom: 6 }}>Couldn't load the Northstar board</div>
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
```

- [ ] **Step 2: Typecheck and lint**

```bash
node_modules/.bin/tsc --noEmit
npm run lint
```

Expected: zero errors.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: exit 0, zero "Module not found".

- [ ] **Step 4: Commit**

```bash
git add components/northstar/NorthstarBoard.tsx
git commit -m "feat(northstar): rewrite board with horizontal columns, highlights, and drawer"
```

---

## Task 6: Final verification

- [ ] **Step 1: Full typecheck + lint + build**

```bash
node_modules/.bin/tsc --noEmit && npm run lint && npm run build
```

Expected: all pass, exit 0.

- [ ] **Step 2: Manual smoke test**

```bash
npm run dev
```

Open `http://localhost:3030`, switch to the Northstar tab, select a CWD with `.northstar.yaml`.

Verify:
1. Board renders lifecycle columns horizontally (left → right).
2. Empty columns collapse to thin strips; click to expand.
3. `quarantined`/`failed` cards have red border; `blocked` cards have orange border.
4. Warning bar appears when problem issues exist.
5. Clicking a card slides open the right-side drawer with snapshot, history, and action buttons.
6. Clicking an action button triggers the CLI stream (stdout/stderr lines appear in drawer).
7. Chat tab still works; Branches/System visible in Chat, hidden in Northstar.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(northstar): board enhanced — layout, highlights, drawer, live execution"
```
