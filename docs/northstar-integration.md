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

- **Source of truth for board UI is `apps/pi-web/components/northstar/`**. `apps/northstar/integrations/pi-web/components/` is reference coverage for Northstar-side integration tests and must not be edited as the primary UI implementation.
- **Northstar is a package dependency** — `package.json` depends on
  `@northstar/runtime` instead of importing from a sibling source path.
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
3. **Top bar** — render `<WorkspaceTabs active={workspaceView} onSelect={…} />`; keep
   Chat-only controls inside `ChatWindow` so they do not sit beside workspace tabs.
4. **Center content** — `workspaceView !== "chat" ? renderWorkspaceView(workspaceView, { activeCwd }) : <existing chat/placeholder logic>`.

`BranchNavigator` is rendered by `ChatWindow` as a session-level control. The former
top-bar System panel is intentionally not part of this Northstar-focused layout.

## Backend data source — board-only loader (important)

`lib/northstar/local-api-loader.js` delegates board reads to
`@northstar/runtime/operator-dashboard/board-only-local-api`, which builds the board
**directly** from Northstar's read-model + store. That package export imports only:

- `src/config/load-config.ts`, `src/adapters/platform/paths.ts`
- `src/runtime/store.ts` (`SqliteControlPlaneStore`, uses `node:sqlite`)
- `src/operator-dashboard/read-model.ts` (`buildNorthstarBoard`)
- `src/operator-dashboard/models.ts` (`defaultNorthstarProjectCapabilities`)

Every file in that closure imports only relative paths and `node:` builtins, so Next
can transpile and bundle `@northstar/runtime` cleanly through `transpilePackages`.

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

`getIssue` and `listIssueEvents` are supported in board-only mode (used by `IssueDrawer` and SSE details).
`getWizard` / `runIssueAction` / `runWizardAction` throw "not available in board-only mode" and are intentionally unsupported by this loader.

`lib/northstar/server-client.ts` selects the **data** (which project / runtime DB) per
request from `?config=<cwd>/.northstar.yaml` (or the `NORTHSTAR_CONFIG` env var). The
Northstar **code** location is now resolved by npm via `@northstar/runtime`, so the UI
no longer depends on `pi-web` and `northstar` being sibling directories.

## Cross-platform suite packaging

`npm run pack:suite` creates `dist/northstar-suite/`, a cross-platform installer folder:

- `packages/*.tgz` — a pi-web package with `@northstar/runtime` vendored as an internal tgz.
- `install.ps1` — Windows PowerShell installer.
- `install.sh` — macOS/Linux installer.
- `README.md` — install instructions.

The script is implemented in `scripts/build-northstar-suite.mjs` so the packaging logic is
portable across Windows and Unix shells. It requires existing `.next` production artifacts;
run `npm run build` first, or call the script with `--build`.

The generated installer is cross-platform but not fully offline: npm still resolves normal
package dependencies such as Next, React, and Pi SDK packages unless they are already cached.
A fully offline installer should add a bundled npm cache or bundled dependencies as a separate
packaging phase.
