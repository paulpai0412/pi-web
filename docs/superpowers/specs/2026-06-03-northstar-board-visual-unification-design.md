# Northstar Board Visual Unification (Pi-native Minimal) — Design Spec

Date: 2026-06-03
Status: Draft for review
Branch: `northstar-board-only`

## Problem

Recent Northstar board feature additions (watch controls, SSE split panel, issue SSE modal) work functionally, but visual language is inconsistent:

- Mixed icon/text control styles
- Slightly different panel/header/button treatments across board/drawer/modal/panel
- Warning emphasis currently too distributed on card borders
- Micro-interactions (hover/focus/disabled) are not fully uniform

## Goals

1. Unify Northstar board UI under **Pi-native minimal** style.
2. Keep current information density (no compacting).
3. Apply consistent visual system to:
   - Northstar board main view
   - Watch SSE split panel
   - Issue SSE modal
   - Issue drawer
4. Use warning strategy:
   - neutral card borders
   - warning emphasis via dot/icon + warning bar
5. Keep all behavior/API logic unchanged.

## User-confirmed style decisions

- Visual direction: **A. Pi-native minimal**
- Scope: **D. Full northstar board + micro-interactions**
- Density: **A. Keep current density**
- Warning strategy: **C. warnings on icon/dot, neutral card borders**

## Non-goals

- Changing watch/session/SSE behavior
- Reworking data flow or API contracts
- Introducing a new global design system framework
- Refactoring to class-based global CSS architecture

## Approach options considered

### Option 1 (Recommended): Local style-token normalization in existing files

- Add/normalize small style constants inside each Northstar component file.
- Standardize icon button sizing, borders, radius, transitions, focus ring, disabled state.
- Standardize panel chrome + section headers.

**Pros:** Surgical changes, low risk, fast delivery, minimal churn.
**Cons:** Tokens remain local rather than centralized globally.

### Option 2: Shared `components/northstar/ui.ts`

- Centralize token/style factories and consume from all Northstar components.

**Pros:** Long-term consistency and maintainability.
**Cons:** Bigger refactor surface and regression risk for current scope.

### Option 3: Convert to CSS classes in `globals.css`

- Move Northstar styles from inline to class-based CSS.

**Pros:** Styling consolidated in one place.
**Cons:** Large migration; not surgical for requested scope.

## Recommendation

Use **Option 1** now (surgical unification), and consider Option 2 later if more Northstar UI surfaces are added.

## Visual rules

### 1) Icon controls

All icon controls in header/cards/modals/panels use a shared geometry:

- size: `28x26` (or same-sized variant if space constrained)
- border: `1px solid var(--border)`
- background: `var(--bg-panel)`
- foreground: `var(--text)`
- radius: `5px`
- transition: `background/border/color 140ms ease`
- hover: background `var(--bg-hover)`
- focus-visible: outline/ring with `var(--accent)`
- disabled: reduced opacity + `not-allowed`

### 2) Panel chrome

Board header, drawer shell, modal shell, watch split panel share panel chrome conventions:

- panel background uses `var(--bg)`
- separators use `var(--border)`
- section titles use uppercase tiny label style (`11px`, muted)
- stream/JSON/history monospace content uses consistent muted tone + spacing

### 3) Card warning treatment (strategy C)

- card border: always neutral `var(--border)`
- warning signal only via:
  - colored status dot (`red`/`orange`)
  - warning icon where relevant
  - top warning bar aggregate counts
- no full-card red/orange border outlines

### 4) Micro-interactions

Apply consistently to clickable UI:

- hover feedback visible but subtle
- active state subtle (no large transform changes)
- focus-visible accessible and consistent
- transition timing unified across components

## File-level plan

### Modify

1. `components/northstar/NorthstarBoard.tsx`
   - unify header/icon button styles
   - unify column headers/card surfaces
   - neutralize card borders while keeping warning dot/icon
   - align warning bar and section typography

2. `components/northstar/WatchSsePanel.tsx`
   - unify split panel chrome, control buttons, resize handle affordance

3. `components/northstar/IssueSseModal.tsx`
   - unify modal header/buttons/stream area styling

4. `components/northstar/IssueDrawer.tsx`
   - unify section headers/actions/link/button appearance

## Data/behavior impact

- No API changes
- No state-machine changes
- No SSE reconnection behavior changes
- No watch start/stop flow changes

## Verification

### Static

- `node_modules/.bin/tsc --noEmit`
- `npm run lint`

### Manual

1. Header icon controls (refresh/start-stop/sse) render with consistent style.
2. Card SSE icon button style matches header control language.
3. Cards keep neutral borders; warning still clear via dot/icon + warning bar.
4. Drawer/modal/watch panel share unified panel/button/section styles.
5. Hover/focus/disabled behavior is visibly consistent across controls.
6. No functional regression in watch start/stop, auto-refresh, SSE panel/modal.

## Risks

- Pure visual edits can accidentally alter spacing/alignment in dense areas.
- Inline-style normalization may leave small inconsistencies unless reviewed side-by-side.

Mitigation: keep edits surgical; verify all four Northstar surfaces manually after change.
