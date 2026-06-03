# Northstar Board Enhanced Design Spec

Date: 2026-06-03
Status: Approved
Branch: `northstar-board-only`
Supersedes: adds to `2026-06-03-northstar-board-only-design.md`

## Problem

The current `NorthstarBoard.tsx` is a functional read-only kanban but lacks:

1. **Usable layout** — columns are wrapped in a `grid auto-fit` that stacks vertically on normal screens; empty lifecycle columns waste horizontal space.
2. **GitHub / PR links** — cards show `View PR ↗` for `prUrl` but no GitHub issue link.
3. **Live streaming** — no way to watch a running worker's progress from the board.
4. **Action buttons** — no per-lifecycle actions; the state machine's valid commands are not surfaced.
5. **Issue snapshot + history** — no way to inspect a card's detail, timeline, or accepted artifacts.
6. **Problem highlighting** — blocked/quarantined/failed cards look the same as healthy ones.

## Goals

1. Horizontal lifecycle column layout (left → right per lifecycle order).
2. Empty columns collapse to a thin strip (collapse/expand on click).
3. Per-card highlight: `quarantined`/`failed` red border; `blocked`/`projectionFailure` orange border; problem cards float to column top; board-level warning bar.
4. Right-side slide-out drawer: snapshot + state-machine action buttons + live history/SSE stream.
5. Action buttons map to northstar CLI commands, executed via northstar skill with arguments.
6. SSE streaming: pi host → subscribe to `/api/agent/{latestRootSessionId}/events`; other adapters → poll SQLite history diff.
7. GitHub issue link + PR link on each card (when available).

## Non-goals

- Actually spawning the northstar CLI from pi-web (node version constraint, architecture boundary).
- Wizard / assistant tabs.
- Any changes to `app/api/northstar/*` routes except adding `getIssue` / `listIssueEvents` to `local-api-loader.js`.

## Architecture

### Data layer additions (backend)

`lib/northstar/local-api-loader.js` currently throws on `getIssue` and `listIssueEvents`. Both
are implementable from the same bundle-clean closure already imported:

```
buildNorthstarIssueDetail(input: { snapshot, title, sourceUrl, labels, history })
```

`getIssue(issueId)`:
1. `loadConfig(configPath)` → open store
2. `store.getIssue(issueId)` → snapshot
3. `store.listHistory(issueId)` → history entries
4. `buildNorthstarIssueDetail({ snapshot, history, title: snapshot.title, sourceUrl: snapshot.source_url, labels: [] })`

`listIssueEvents(issueId)`:
1. Same store read → `history.map(runEventForHistory)`

The existing API routes `GET /api/northstar/projects/[projectId]/issues/[issueId]` and
`GET /api/northstar/projects/[projectId]/issues/[issueId]/events` already proxy to these
methods — they just need to stop throwing.

### SSE streaming (per-issue, in drawer)

Two modes keyed on `latestHostAdapter` of the card:

**pi host** (`latestHostAdapter === "pi"` and `latestRootSessionId` is set):
- Drawer subscribes to existing `/api/agent/{latestRootSessionId}/events` SSE.
- This is pi-web's own agent event stream — zero new infrastructure.
- Shows the same structured agent events as the Chat tab.

**Other adapters (codex, opencode)** or no active session:
- Drawer polls `GET /api/northstar/.../issues/{issueId}/events` every 2 s.
- Diffs against last-seen sequence number, appends new `NorthstarRunEvent` entries.
- Stops polling when lifecycle moves to a terminal state (`completed`, `cancelled`, `failed`, `quarantined`).

### Action buttons — state machine mapping

Buttons pass a composed CLI argument string to the northstar skill via
`/northstar-execute <args>` or `/northstar-recover <args>`. The skill's built-in
Execution Gate / Recovery Gate handles confirmation before mutation.

| lifecycle | button label | CLI args | skill |
|---|---|---|---|
| `ready` | Start | `start --issue <issueId> --config <configPath>` | `/northstar-execute` |
| `claimed` | Reconcile | `reconcile --issue <issueId> --config <configPath>` | `/northstar-execute` |
| `running` | Reconcile | `reconcile --issue <issueId> --config <configPath>` | `/northstar-execute` |
| `verifying` | Reconcile | `reconcile --issue <issueId> --config <configPath>` | `/northstar-execute` |
| `verified` | Release | `release --issue <issueId> --config <configPath>` | `/northstar-execute` |
| `release_pending` | Reconcile | `reconcile --issue <issueId> --config <configPath>` | `/northstar-execute` |
| `failed` | Reconcile | `reconcile --issue <issueId> --config <configPath>` | `/northstar-recover` |
| `quarantined` | Repair runtime | `repair-runtime --issue <issueId> --config <configPath>` | `/northstar-recover` |
| `completed` / `cancelled` | — | none | — |

Additional: when `projectionFailure === true` or `blocked === true`, show a secondary
`Retry sync` button: `retry-sync --issue <issueId> --config <configPath>` via `/northstar-execute`.

**Button interaction:** Clicking a button copies the full `/northstar-execute <args>` (or
`/northstar-recover <args>`) slash command string to the clipboard and shows a toast
"Copied — paste into Claude Code to run". This keeps pi-web stateless and delegates
execution entirely to the skill.

### Layout

```
board header: project name + repo + host adapter + refresh button
warning bar (shown only when problems exist):
  ⚠ 3 issues need attention: quarantined ×1  failed ×1  blocked ×1

lifecycle columns (horizontal scroll, left → right):
  ready | claimed | running | verifying | verified | release_pending | completed | cancelled | failed | quarantined

columns with cards: full-width (minmax 220px, 1fr in grid)
empty columns: collapsed to a thin strip (~28px wide), click to expand
```

### Card design

```
┌─────────────────────────────┐  ← red border (quarantined / failed)
│ #99  ● quarantined    ⚠    │  ← status dot + lifecycle label + warning icon
│ Fix 2FA on login page       │  ← title (ellipsis overflow)
│ stage: —  host: pi  deps 2  │  ← pill row
│ next: repair-runtime        │  ← nextRecommendedAction
│ [GitHub #99 ↗]              │  ← sourceUrl link (when available)
└─────────────────────────────┘

┌─────────────────────────────┐  ← orange border (blocked / projectionFailure)
│ #50  ● blocked        ⚠    │
│ Integrate third-party pay   │
│ stage: implement  deps 3    │
└─────────────────────────────┘

┌─────────────────────────────┐  ← normal card (thin grey border)
│ #42  ● running              │
│ Add member discount logic   │
│ stage: implement  host: pi  │
│ [View PR ↗]                 │  ← prUrl (when present)
└─────────────────────────────┘
```

Problem cards (`quarantined`, `failed`, `blocked`, `projectionFailure`) sort to the top of their column.

### Drawer

```
┌── right drawer (420px, slides in over board) ──────────────────┐
│ #42  running                                              [✕]   │
│ Add member discount logic                                       │
│ stage: implement  host: pi  deps 0                              │
│ [GitHub #42 ↗]  [View PR ↗]                                    │
│─────────────────────────────────────────────────────────────── │
│ Actions                                                         │
│  [Reconcile]  (copies /northstar-execute reconcile --issue 42) │
│  [Retry sync] (shown if projectionFailure/blocked)              │
│─────────────────────────────────────────────────────────────── │
│ Snapshot  ▾ (collapsible JSON viewer)                           │
│─────────────────────────────────────────────────────────────── │
│ Live stream  ▾                                                  │
│  10:02  worker_started       info                               │
│  10:03  stage → implement    info                               │
│  10:04  effect: edit auth.ts info                               │
│  10:05  running tests…       info                               │
│  [loading spinner if active session]                            │
│─────────────────────────────────────────────────────────────── │
│ History list  ▾  (all NorthstarRunEvent entries, newest last)   │
│  2026-06-03T09:41  worker_started                               │
│  2026-06-03T09:42  stage_transition: ready → claimed            │
└────────────────────────────────────────────────────────────────┘
```

Multiple drawers are NOT supported simultaneously — opening a second card replaces the
current drawer. Drawer is independent of the board scroll position.

## Components & files

### Modified

- `lib/northstar/local-api-loader.js` — implement `getIssue()` and `listIssueEvents()` using
  `store.getIssue()`, `store.listHistory()`, `buildNorthstarIssueDetail`, `runEventForHistory`.

### New (additive, upgrade-safe)

- `components/northstar/NorthstarBoard.tsx` — **rewrite** existing file:
  - Horizontal layout with collapsible empty columns.
  - Warning bar for problem issues.
  - Red/orange border highlight + top-sort for problem cards.
  - GitHub issue link from `card.sourceUrl` (parsed from issue detail, or passed via board card if available).
  - Click card → open drawer.

- `components/northstar/IssueDrawer.tsx` — right-side drawer:
  - Fetches `GET /api/northstar/projects/{projectId}/issues/{issueId}` for snapshot + detail.
  - Fetches `GET /api/northstar/projects/{projectId}/issues/{issueId}/events` for history list.
  - Subscribes to SSE (pi host: `/api/agent/{sessionId}/events`; other: polls events route).
  - State-machine action buttons (copy-to-clipboard model).
  - Collapsible sections: Snapshot JSON, Live stream, History list.

- `components/northstar/useIssueStream.ts` — React hook encapsulating the two-mode
  streaming logic (EventSource for pi host; interval poll + diff for others). Returns
  `NorthstarRunEvent[]` and `isLive: boolean`.

### Unchanged

- `app/api/northstar/*` routes (already proxy getIssue/listIssueEvents correctly).
- `WorkspaceTabs.tsx`, `workspace-views.tsx`, `AppShell.tsx` seams.
- `lib/northstar/server-client.ts`, `lib/northstar/types.ts`.

## Verification

```bash
node_modules/.bin/tsc --noEmit   # must pass
npm run lint                      # must pass
npm run build                     # exit 0, zero "Module not found"
```

Manual:
1. Board renders horizontal columns; empty columns collapse to thin strip.
2. `quarantined`/`failed` cards have red border; `blocked` cards have orange border; warning bar appears.
3. Clicking a card slides open the right drawer with snapshot + history.
4. For a running issue with `latestHostAdapter === "pi"`, live stream section shows events from `/api/agent/{sessionId}/events`.
5. Action button copies correct `/northstar-execute` or `/northstar-recover` command to clipboard.
6. Switching back to Chat tab works; Branches/System still visible in Chat, hidden in Northstar.

## Implementation order

1. `local-api-loader.js` — add `getIssue` + `listIssueEvents`.
2. `useIssueStream.ts` — streaming hook (pi SSE + poll-diff modes).
3. `IssueDrawer.tsx` — drawer component with snapshot, stream, history, action buttons.
4. `NorthstarBoard.tsx` — rewrite: horizontal layout, collapsible empty columns, warning bar, highlight, drawer wiring.
5. Typecheck + lint + build.
