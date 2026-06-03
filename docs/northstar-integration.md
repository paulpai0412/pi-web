# Northstar integration — upgrade notes

pi-web is an upstream npm package (`@agegr/pi-web`). The Northstar board is a local
add-on. This file records exactly where the add-on diverges from upstream so the
integration can be re-applied after a pi-web upgrade with minimal effort.

## Design rule

- **All Northstar code is additive** and lives in Northstar-named dirs that don't exist
  upstream — these never conflict on upgrade:
  - `components/northstar/` — `NorthstarBoard.tsx`, `WorkspaceTabs.tsx`, `workspace-views.tsx`
  - `lib/northstar/` — `server-client.ts`, `local-api-loader.js`, `types.ts`
  - `app/api/northstar/` — API routes
- **No new npm dependencies** — `package.json` / lockfile do not diverge.
- The board talks only to the existing `/api/northstar/*` routes, which proxy to the
  real Northstar install. UI and data are decoupled.

## Adding a future Northstar tab

Edit **only** `components/northstar/workspace-views.tsx` — append an entry to
`WORKSPACE_VIEWS` (`{ id, label, icon, render }`). The tab appears automatically in the
top bar and its content renders via the registry. **No `AppShell.tsx` change needed.**

## The only shared-file divergence: `components/AppShell.tsx`

Four small, comment-marked seams (search for `>>> northstar`). After upgrading pi-web,
re-apply these if upstream overwrote `AppShell.tsx`:

1. **Imports** — `WorkspaceTabs` + `renderWorkspaceView` from `./northstar/...`.
2. **`workspaceView` state** — typed `string` (registry-driven), initial `"chat"`.
3. **Top bar** — render `<WorkspaceTabs active={workspaceView} onSelect={…} />`; gate the
   pi-web Branches/System block and the session-stats block on
   `workspaceView === "chat"` so chat-only controls hide in non-chat views.
4. **Center content** — `workspaceView !== "chat" ? renderWorkspaceView(workspaceView, { activeCwd }) : <existing chat/placeholder logic>`.

Nothing else in AppShell is removed — pi-web's `BranchNavigator`, System button, and
`activeTopPanel` machinery are original pi-web features and stay intact.

## Backend data source — board-only loader (important)

`lib/northstar/local-api-loader.js` builds the board **directly** from Northstar's
read-model + store, importing only:

- `src/config/load-config.ts`, `src/adapters/platform/paths.ts`
- `src/runtime/store.ts` (`SqliteControlPlaneStore`, uses `node:sqlite`)
- `src/operator-dashboard/read-model.ts` (`buildNorthstarBoard`)
- `src/operator-dashboard/models.ts` (`defaultNorthstarProjectCapabilities`)

Every file in that closure imports only relative paths and `node:` builtins, so
webpack bundles it cleanly from the out-of-tree `apps/northstar` source.

**Why not import Northstar's `local-api.ts`?** Its `getBoard()` is what we replicate,
but the module also statically imports the production orchestrator chain
(`production-factory → codex-worker → sdk-loaders`), and `sdk-loaders.ts` does
`import("@earendil-works/pi-coding-agent")` — a *host-provided* dependency that
`apps/northstar` does not vendor. webpack cannot resolve that bare import from the
out-of-tree source (Next 16's app-router layer ignores `serverExternalPackages` /
`resolve.modules` / `externals` for out-of-root modules), and runtime dynamic import
is impossible because this Node build has no TypeScript support and `apps/northstar`
ships no compiled JS. Bypassing the orchestrator sidesteps all of that — and the board
only ever needs `getBoard()` (a SQLite read), never the agent-runner the SDK is for.

`getIssue` / `listIssueEvents` / `getWizard` / `runIssueAction` / `runWizardAction`
throw "not available in board-only mode" — the board UI never calls them.

`lib/northstar/server-client.ts` selects the **data** (which project / runtime DB) per
request from `?config=<cwd>/.northstar.yaml` (or the `NORTHSTAR_CONFIG` env var). The
Northstar **source** location is fixed by the relative import in `local-api-loader.js`
(`../../../northstar/...`); if the install moves, update that one path.
