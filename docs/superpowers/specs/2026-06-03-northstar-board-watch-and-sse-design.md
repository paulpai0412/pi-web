# Northstar Board Watch + SSE UX Design Spec

Date: 2026-06-03
Status: Draft for review
Branch: `northstar-board-only`

## Problem

Current Northstar board gaps:

1. Refresh button is present but not functionally useful to users (no auto-refresh control).
2. No board-level long-running watch control tied to a dedicated Pi session.
3. Live streaming UX is currently centered in `IssueDrawer`; requirement now splits into two independent views:
   - global watch session SSE (board-level)
   - per-issue root session SSE (issue-level)

## Goals

1. Fix refresh behavior and add configurable auto-refresh (seconds).
2. Add **Start / Stop watch** controls in board header.
3. Implement watch as a **Pi session prompt flow** (not direct CLI spawn).
4. Show watch session SSE in a **bottom split panel** on board.
5. Keep `IssueDrawer` (snapshot/history/actions), but remove live SSE from it.
6. Add per-card button to open a modal and stream that issue's root session SSE.
7. Implement robust SSE reconnect strategy: auto-retry + manual reconnect fallback.

## User-confirmed constraints

- Use brainstorming-first flow before implementation.
- Auto refresh mode: **A** (default OFF, user manually enables and sets seconds).
- Global watch and per-issue SSE are **independent sessions** and independent views.
- Keep `IssueDrawer`, only remove its live SSE section.
- Watch execution must be "a Pi session with prompt".
- Stop strategy: **C** (abort first, then stop prompt).
- Auto-stop condition for watch when pending count is 0 over these lifecycles only:
  - `ready`, `claimed`, `running`, `verifying`, `verified`, `release_pending`
  - explicitly **exclude** `failed` and `quarantined` from pending criteria.
- Global watch SSE layout: bottom split panel.
- Watch prompt UX: **C** (default template + user override input).
- SSE should be live and use reconnect policy: **C** (auto-reconnect, then offer manual reconnect after repeated failures).

## Non-goals

- Replacing Northstar board architecture.
- Reworking unrelated AppShell workspace tab behavior.
- Redesigning issue actions/state-machine behavior beyond SSE placement.

## Proposed architecture

### 1) Global watch session (board-level)

- Start watch by creating a new Pi session via `POST /api/agent/new`.
- Initial command is `type: "prompt"` with watch prompt text.
- Save returned `sessionId` as `watchSessionId` in board state.
- Stream live events via `GET /api/agent/{watchSessionId}/events` (EventSource).
- Render stream in a board-bottom split panel.

### 2) Stop watch flow (required C strategy)

When user presses Stop (or auto-stop triggers):

1. Send `POST /api/agent/{watchSessionId}` `{ type: "abort" }`.
2. Then send `POST /api/agent/{watchSessionId}` `{ type: "prompt", message: <stop prompt> }`.
3. Keep UI state as stopping/running until stream closes or timeout transitions to idle.

### 3) Auto-refresh

- Header controls:
  - toggle (default OFF)
  - seconds input (validated min threshold, e.g. 2s)
- Interval calls existing `load(configPath)`.
- Manual refresh always available and immediate.

### 4) Auto-stop condition

After each board reload, compute pending count from board groups using only:

- `ready`
- `claimed`
- `running`
- `verifying`
- `verified`
- `release_pending`

If total pending is 0 and watch is running, trigger Stop flow.

### 5) Per-issue SSE modal

- Add card action button: `View SSE`.
- Open modal for that card using `card.latestRootSessionId`.
- Stream from `GET /api/agent/{sessionId}/events`.
- If no root session id: show explicit empty-state message.

### 6) IssueDrawer adjustment

- Keep drawer features (snapshot/history/actions).
- Remove live SSE section from drawer UI.

### 7) SSE reconnect behavior

Shared reconnect policy for watch panel and issue modal:

- Auto reconnect with delay (e.g. 2s, capped retries/backoff).
- Track consecutive failures.
- After threshold (e.g. 5 attempts), show a manual reconnect button while keeping auto-retry conservative.

## UI design summary

### Header additions

- `Refresh` button (working)
- `Auto refresh` toggle + seconds input
- `Start Watch` / `Stop Watch`
- Prompt input area:
  - default template prefilled/visible
  - user override editable

### Bottom split panel (watch)

- Live stream lines (token/event style text)
- Status chip: `live / reconnecting / stopped`
- reconnect diagnostics (attempt count)
- manual `Reconnect` button after repeated failures
- optional `Clear` output button (UI only)

### Issue card

- Keep current click behavior for drawer.
- Add dedicated `View SSE` button (stops event propagation so it won’t open drawer unintentionally).

### Issue SSE modal

- Title includes issue label/session id.
- Live streaming area with same reconnect UX.
- Empty state when no root session id.

## File-level design (targeted changes)

### Modify

1. `components/northstar/NorthstarBoard.tsx`
   - Add refresh/auto-refresh/watch controls.
   - Add global watch session orchestration state.
   - Add bottom split panel.
   - Add per-card `View SSE` button wiring.
   - Add auto-stop pending-count evaluation.

2. `components/northstar/IssueDrawer.tsx`
   - Remove live SSE section.
   - Keep actions/snapshot/history intact.

3. `components/northstar/useIssueStream.ts` (or replacement usage)
   - If reused for modal only, narrow scope accordingly.

### New

1. `components/northstar/usePiSessionSse.ts`
   - Reusable hook for Pi session EventSource stream + reconnect logic.
   - Shared by watch split panel and issue SSE modal.

2. `components/northstar/IssueSseModal.tsx`
   - Modal UI for per-issue root session live SSE.

3. `components/northstar/WatchSsePanel.tsx`
   - Bottom split panel for global watch stream rendering.

> Note: component extraction can be adjusted minimally during implementation to match current file style, but behavior requirements above are fixed.

## Data/contracts

### Existing APIs reused

- `POST /api/agent/new` (create watch session + first prompt)
- `POST /api/agent/{id}` (abort + follow-up prompt)
- `GET /api/agent/{id}/events` (SSE stream)
- Existing northstar board fetch APIs unchanged.

### Prompt template behavior

- Default watch template exists in UI state.
- User may override text before Start.
- Start uses override when non-empty, else default template.

## Error handling

- Session create failure: show inline header error, no panel activation.
- SSE parse/connection failure: enter reconnect state.
- Reconnect threshold reached: present manual reconnect CTA.
- Stop flow partial failure:
  - if abort fails, still attempt stop prompt.
  - surface warning while preserving session context for retry.

## Verification criteria

1. Manual refresh button reloads board immediately.
2. Auto refresh is OFF by default.
3. Enabling auto refresh triggers periodic reload at configured seconds.
4. Start watch creates a new Pi session and opens live bottom split SSE panel.
5. Stop executes abort-then-stop-prompt sequence.
6. When pending (ready/claimed/running/verifying/verified/release_pending) reaches 0, watch auto-stops.
7. `failed` and `quarantined` do not block auto-stop.
8. IssueDrawer no longer contains live SSE section.
9. Card `View SSE` opens modal and streams root session live.
10. SSE disconnect shows reconnecting state, retries automatically, then provides manual reconnect option after repeated failures.

## Risks / trade-offs

- Board component state complexity increases; mitigated by extracting stream panel/modal + shared hook.
- Abort + stop prompt sequence may vary by model/provider responsiveness; UI must tolerate eventual consistency.
- Auto-stop depends on successful board reload cadence; if refresh disabled, only manual stop guarantees immediate stop.

## Recommendation

Implement with minimal, surgical changes using existing agent APIs and small isolated UI components (`IssueSseModal`, `WatchSsePanel`, `usePiSessionSse`) to keep behavior explicit without over-abstracting.
