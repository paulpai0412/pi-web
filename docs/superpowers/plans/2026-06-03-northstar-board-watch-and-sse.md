# Northstar Board Watch + SSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add working refresh/auto-refresh, board-level watch start/stop with live split SSE panel, and per-issue root-session SSE modal while removing live SSE from IssueDrawer.

**Architecture:** Reuse existing `/api/agent/*` endpoints for Pi-session orchestration. Add a shared Pi SSE hook and two focused UI components (watch panel + issue modal). Keep `NorthstarBoard` as coordinator, and keep `IssueDrawer` for detail/actions/history only.

**Tech Stack:** Next.js App Router, React 19, TypeScript, EventSource SSE, existing pi-web agent APIs.

---

## File map

- Create: `components/northstar/usePiSessionSse.ts`
- Create: `components/northstar/WatchSsePanel.tsx`
- Create: `components/northstar/IssueSseModal.tsx`
- Modify: `components/northstar/NorthstarBoard.tsx`
- Modify: `components/northstar/IssueDrawer.tsx`
- (Optional cleanup) Modify or remove usage in: `components/northstar/useIssueStream.ts`

---

### Task 1: Add shared Pi session SSE hook

**Files:**
- Create: `components/northstar/usePiSessionSse.ts`

- [ ] **Step 1: Implement hook contract**

Create `usePiSessionSse(sessionId)` that returns:
- `lines`
- `isLive`
- `isReconnecting`
- `reconnectAttempts`
- `error`
- `reconnectNow()`
- `clear()`

Behavior:
- Connect via `EventSource('/api/agent/{id}/events')`
- Parse events into display lines
- On disconnect, auto-retry (2s delay)
- After repeated failures (>=5), expose manual reconnect affordance state

- [ ] **Step 2: Validate static quality**

Run: `node_modules/.bin/tsc --noEmit`
Expected: no TypeScript errors from new hook.

- [ ] **Step 3: Commit**

```bash
git add components/northstar/usePiSessionSse.ts
git commit -m "feat(northstar): add reusable Pi session SSE hook with reconnect"
```

---

### Task 2: Add board-level watch split panel

**Files:**
- Create: `components/northstar/WatchSsePanel.tsx`
- Use: `components/northstar/usePiSessionSse.ts`

- [ ] **Step 1: Build panel UI**

Implement bottom split panel with:
- header/status (`live`, `reconnecting`, `stopped`)
- stream list rendering
- reconnect attempt indicator
- `Reconnect` button (shown after threshold)
- `Clear` button

- [ ] **Step 2: Ensure panel is presentational**

Props should include only needed inputs (`sessionId`, `onClose?`, `title?`) and avoid board-specific coupling.

- [ ] **Step 3: Validate**

Run: `node_modules/.bin/tsc --noEmit`
Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add components/northstar/WatchSsePanel.tsx
git commit -m "feat(northstar): add bottom watch SSE split panel component"
```

---

### Task 3: Add issue root-session SSE modal

**Files:**
- Create: `components/northstar/IssueSseModal.tsx`
- Use: `components/northstar/usePiSessionSse.ts`

- [ ] **Step 1: Implement modal UI**

Modal requirements:
- Accept `card`, `sessionId`, `onClose`
- If no `sessionId`, show explicit empty state
- If session exists, show live stream and reconnect controls
- Stop click propagation so it behaves independently from drawer

- [ ] **Step 2: Validate**

Run: `node_modules/.bin/tsc --noEmit`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add components/northstar/IssueSseModal.tsx
git commit -m "feat(northstar): add per-issue SSE modal for root sessions"
```

---

### Task 4: Integrate controls + watch orchestration in NorthstarBoard

**Files:**
- Modify: `components/northstar/NorthstarBoard.tsx`
- Use: `components/northstar/WatchSsePanel.tsx`
- Use: `components/northstar/IssueSseModal.tsx`

- [ ] **Step 1: Fix manual refresh + add auto-refresh controls**

Add header controls:
- working `Refresh`
- auto-refresh toggle (default OFF)
- seconds input

Implement interval to call existing `load(configPath)` when enabled.

- [ ] **Step 2: Add watch start/stop controls**

Start flow:
- `POST /api/agent/new` with `cwd`, `type: 'prompt'`, `message`
- save `watchSessionId`
- show split panel

Stop flow (required strategy C):
1) `POST /api/agent/{id}` `{type:'abort'}`
2) then `POST /api/agent/{id}` `{type:'prompt', message:'...stop...'}`

- [ ] **Step 3: Add auto-stop check based on pending lifecycle count**

After each successful board reload, compute pending as sum of:
- `ready`, `claimed`, `running`, `verifying`, `verified`, `release_pending`

If pending is 0 and watch is running, trigger stop flow.

- [ ] **Step 4: Add per-card `View SSE` button + modal wiring**

- Keep card click opening `IssueDrawer`
- Add separate button opening `IssueSseModal`
- Ensure button uses `stopPropagation()`

- [ ] **Step 5: Validate**

Run:
```bash
node_modules/.bin/tsc --noEmit
npm run lint
```
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add components/northstar/NorthstarBoard.tsx
git commit -m "feat(northstar): add refresh controls, watch session orchestration, and issue SSE modal integration"
```

---

### Task 5: Remove live SSE from IssueDrawer

**Files:**
- Modify: `components/northstar/IssueDrawer.tsx`
- (Optional) Modify: `components/northstar/useIssueStream.ts`

- [ ] **Step 1: Remove live stream section from drawer UI**

Keep:
- snapshot
- history
- actions

Remove only live SSE rendering/labels and related state wiring in drawer.

- [ ] **Step 2: Keep behavior stable**

Ensure drawer still opens/closes, fetches detail, and action buttons still call existing run endpoints.

- [ ] **Step 3: Validate**

Run:
```bash
node_modules/.bin/tsc --noEmit
npm run lint
```
Expected: pass and no unused-import lint errors.

- [ ] **Step 4: Commit**

```bash
git add components/northstar/IssueDrawer.tsx components/northstar/useIssueStream.ts
git commit -m "refactor(northstar): remove drawer live SSE and keep detail/history/actions"
```

---

### Task 6: End-to-end verification

**Files:**
- No code changes expected (verification only)

- [ ] **Step 1: Static verification**

Run:
```bash
node_modules/.bin/tsc --noEmit
npm run lint
```
Expected: both pass.

- [ ] **Step 2: Manual verification checklist**

Run `npm run dev` and verify:
1. Refresh button reloads board.
2. Auto-refresh default OFF; ON refreshes at configured interval.
3. Start creates watch session and shows live split panel.
4. Stop executes abort then stop prompt.
5. Pending count reaching 0 auto-stops watch (excluding failed/quarantined).
6. IssueDrawer has no live SSE section.
7. Card `View SSE` opens modal and shows live session stream.
8. Disconnect handling shows reconnecting + manual reconnect after repeated failures.

- [ ] **Step 3: Final commit (if verification-only tweaks were needed)**

```bash
git add -A
git commit -m "chore(northstar): finalize watch + SSE UX verification fixes"
```
