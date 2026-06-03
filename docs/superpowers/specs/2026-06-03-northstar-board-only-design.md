# Northstar Board-Only Integration — Design Spec

Date: 2026-06-03
Status: Approved
Branch: `northstar-board-only`

## Problem

The Northstar page in pi-web cannot load. Both the UI component and the backend
loader `import`/`require` from a worktree path that no longer exists:

- `components/northstar/NorthstarDashboard.tsx` → `require(".../.codex/worktrees/0536/northstar/integrations/pi-web/components/NorthstarDashboard")`
- `lib/northstar/local-api-loader.js` → `export … from ".../.codex/worktrees/0536/northstar/src/operator-dashboard/local-api.ts"`
- `lib/northstar/server-client.ts` → `DEFAULT_NORTHSTAR_ROOT = "/home/timmypai/.codex/worktrees/0536/northstar"`

`/home/timmypai/.codex/worktrees/0536` is gone. The stable install is
`/home/timmypai/apps/northstar` (`@northstar/runtime`, branch `main`).

## Goals

1. Northstar page connects again, pointing at the real install.
2. The Northstar view shows **only a read-only board** — no wizard/assistant tabs,
   no per-card action buttons.
3. Top-bar navigation becomes two explicit tabs: **Chat | Northstar**.
4. **Upgrade resilience**: minimise the divergence surface against upstream pi-web,
   and make *future* Northstar tabs addable without editing shared files.

## Non-goals

- Wizard / assistant / issue-action functionality (explicitly dropped for now).
- Removing or changing pi-web's own Branches / System controls — confirmed to be
  original pi-web features (first commit `95c7a65`, predating Northstar by ~3 months).
  They stay.
- Reading the Northstar runtime DB directly from pi-web. Data still flows through the
  existing `/api/northstar/*` routes → real install's local-api.

## Architecture

Two layers, kept separate:

- **Data layer (backend)** — existing `app/api/northstar/*` routes already return
  `{ projects: [...] }` and `{ board }`. Only the *loader path* is broken. Fix it to
  point at `/home/timmypai/apps/northstar`, still overridable via `NORTHSTAR_ROOT`.
- **UI layer (frontend)** — stop mounting the external dashboard component. Build a
  self-contained, read-only board in pi-web that fetches the existing routes. This is
  the only way to get board-only without editing the external repo.

### Upgrade-resilience strategy

- **Additive-only** for everything in `*/northstar/*` dirs and new components — these
  don't exist upstream, so upstream upgrades never conflict.
- **Registry-driven workspace tabs**: a Northstar-owned registry declares the extra
  workspace views. Adding a future Northstar tab = edit only that registry file, **zero
  `AppShell.tsx` edits**.
- **No new npm dependencies** → `package.json` / lockfile do not diverge.
- AppShell divergence reduced to **4 small, comment-marked seams, no deletions.**

## Data flow

```
NorthstarBoard (client)
  GET /api/northstar/projects?config=<cwd>/.northstar.yaml      → { projects: [project] }
  GET /api/northstar/projects/<projectId>?config=<…>            → { board }
```

API contract (unchanged):
- `config` query param = absolute path to `.northstar.yaml` (or `NORTHSTAR_CONFIG` env).
- `apiPath(path, configPath)` = `${path}?config=${encodeURIComponent(configPath)}`.
- `readJson` throws `payload.error ?? "… failed with <status>"` on non-ok.

`NorthstarBoard` shape (from `lib/northstar/types.ts`): `{ project, groups: [{ lifecycle, cards: [...] }] }`.

## Components & files

### New (additive — upgrade-safe)

- `components/northstar/NorthstarBoard.tsx` — read-only kanban.
  - Header: `project.name`, `project.repo`, `host: project.hostAdapter`.
  - Columns per `group.lifecycle`; cards show issue label (`#num` or issueId), status
    dot, title, pills (`currentStage`, `host`, `deps`, `projection`/`blocked` flags),
    `next: <nextRecommendedAction>`, and a PR link when `prUrl` is present.
  - **No action buttons, no issue-detail drawer.**
  - States: loading, empty (no `.northstar.yaml` / no project), error — friendly,
    never crashes the page.
- `components/northstar/workspace-views.tsx` — registry of non-chat workspace views:
  ```ts
  export const WORKSPACE_VIEWS = [
    { id: "northstar", label: "Northstar", icon, render: (ctx) => <NorthstarBoard configPath={cwdToConfig(ctx.activeCwd)} /> },
  ];
  ```
- `components/northstar/WorkspaceTabs.tsx` — renders the `Chat | <registry…>` tab row
  in the top bar; `active: string`, `onSelect: (id) => void`.
- `docs/northstar-integration.md` — lists the exact upstream touch points and the
  re-apply checklist after a pi-web upgrade.

### Modified

- `lib/northstar/server-client.ts` — `DEFAULT_NORTHSTAR_ROOT = "/home/timmypai/apps/northstar"`.
- `lib/northstar/local-api-loader.js` — re-point relative import to
  `../../../northstar/src/operator-dashboard/local-api.ts`.
- `components/AppShell.tsx` — 4 comment-marked seams (`{/* >>> northstar */} … {/* <<< */}`):
  1. Single Northstar toggle button → `<WorkspaceTabs active={workspaceView} onSelect={setWorkspaceView} />`.
  2. Center content → `workspaceView === "chat" ? <ChatWindow/> : renderWorkspaceView(workspaceView, ctx)`.
  3. Branches/System guard `showChat &&` → `showChat && workspaceView === "chat" &&`
     (hide chat-only controls in Northstar view; **a condition tweak, not a deletion**).
  4. `workspaceView` state type `"chat" | "northstar"` → `string`.

### Removed

- `components/northstar/NorthstarDashboard.tsx` — the external-mount shim; no longer used.

### Unchanged

- `BranchNavigator`, System button, `activeTopPanel` machinery, `ChatWindow`, all
  `app/api/northstar/*` routes, `package.json`.

## Verification

No test runner is configured (package.json has only `lint`). Verify via:

- `node_modules/.bin/tsc --noEmit` (typecheck)
- `npm run lint`
- Manual: `npm run dev` (port 3030), select a cwd with `.northstar.yaml`, switch to the
  Northstar tab, confirm the board renders and switching back to Chat works; confirm
  Branches/System still work in Chat view and are hidden in Northstar view.

## Implementation order

1. Backend path fix (`server-client.ts`, `local-api-loader.js`).
2. `NorthstarBoard.tsx` (read-only board).
3. `workspace-views.tsx` registry + `WorkspaceTabs.tsx`.
4. AppShell 4 seams; delete `NorthstarDashboard.tsx` shim.
5. `docs/northstar-integration.md`.
6. Typecheck + lint.
