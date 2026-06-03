# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> A detailed companion document lives in **`AGENTS.md`** (file map, every API route, the full
> pi `.jsonl` session format, CSS variables). Read it for depth; this file is the entry point.

## Mandatory skill

Before any coding, review, refactor, or debugging, follow the **`karpathy-guidelines`** skill
(`~/.agents/skills/superpowers/skills/karpathy-guidelines/SKILL.md`): think before writing,
prefer simplicity, make surgical changes, work toward verifiable goals.

## Commands

```bash
npm run dev    # dev server on port 3030 (webpack, NOT turbopack)
npm run lint   # eslint .
npm run build  # production build → .next/  (webpack)
npm run start  # serve the build on port 30141
npm run release  # version patch + build + npm publish (publishes the .next build)
```

- **Typecheck:** `node_modules/.bin/tsc --noEmit`
- **Never run `next build` (or `npm run build`) while `npm run dev` is running** — it pollutes
  `.next/` and breaks the dev server. They share the same output dir.
- This is the published npm package `@agegr/pi-web`; the prebuilt `.next/` is shipped and run by
  `bin/pi-web.js` (the `pi-web` CLI). `.next/` is therefore a build artifact *and* a release input.

## Big-picture architecture

Next.js 16 (App Router) + React 19 UI over the **pi coding agent**
(`@earendil-works/pi-coding-agent`). One process serves the browser UI, the REST/SSE API, and
the agent itself. The defining split:

- **Read path (session browsing)** — `lib/session-reader.ts` parses `~/.pi/agent/sessions/.../*.jsonl`
  files directly. No `AgentSession` is created. Powers the sidebar tree, message history, context.
- **Write path (talking to the agent)** — `lib/rpc-manager.ts` `startRpcSession()` creates a live
  in-process `AgentSession`, wrapped in an `AgentSessionWrapper`. `POST /api/agent/[id]` sends
  commands; `GET /api/agent/[id]/events` streams results back over SSE.

`next.config.ts` lists the pi packages in `serverExternalPackages` so they run in-process
server-side instead of being webpack-bundled.

### State that must survive hot-reload
Live sessions are keyed in `globalThis.__piSessions` (and start-locks in `globalThis.__piStartLocks`),
**not** a module-level `Map` — Next.js hot-reload discards module state but keeps `globalThis`.
Idle wrappers time out after 10 minutes.

## Traps that have bitten us (see AGENTS.md for the full list)

- **Fork destroys the wrapper immediately.** `AgentSession.fork()` mutates the wrapper's inner state
  in-place (its `sessionId` becomes the *new* session). After capturing `newSessionId`, the wrapper
  calls `this.destroy()` so the next request reloads a clean session from the original file.
  Skipping this corrupts the `parentSession` chain.
- **Two distinct kinds of branching.** *Fork* = a brand-new independent `.jsonl` file (shown as a
  child in the sidebar via the `parentSession` header field). *In-session branch* (`navigate_tree`)
  = multiple leaves inside the **same** file sharing a `parentId`; switching calls
  `/api/sessions/[id]/context?leafId=`. Don't conflate them.
- **ToolCall field normalization.** Pi stores `{type:"toolCall", id, name, arguments}` but our
  `ToolCallContent` uses `{toolCallId, toolName, input}`. `normalizeToolCalls()` in `lib/normalize.ts`
  bridges this and must run on **both** file load (`session-reader.ts`) and streaming
  (`ChatWindow.handleAgentEvent()`).
- **`parentSession` is display-only metadata.** It has zero effect on chat content, so rewriting an
  entire `.jsonl` file (e.g. cascade-reparenting children on delete) is safe.

## Northstar integration (`app/api/northstar/`, `lib/northstar/`)

A newer, pluggable layer exposing an external "operator dashboard" API (projects / board / issues /
wizard) under `/api/northstar/...`. `lib/northstar/server-client.ts` dynamically `import()`s a
local-api module from `NORTHSTAR_ROOT` (config via `?config=` query param or `NORTHSTAR_CONFIG`),
falling back to the bundled `lib/northstar/local-api-loader.js`. Treat the API surface
(`NorthstarServerApi`) as the contract — keep `lib/northstar/types.ts` in sync with the upstream
northstar extension.

## Runtime data & config

- **Sessions dir:** `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`. Override the agent
  data dir with `PI_CODING_AGENT_DIR`.
- **Models:** available models come from `models.json` in the agent data dir (editable via the
  sidebar "Models" panel → `/api/models-config`). `defaultModel` is read from
  `~/.pi/agent/settings.json` and pre-selected for new sessions.
- `.npmrc` sets `legacy-peer-deps=true` — installs may fail without it.

## Layout quick reference

- `app/api/**` — REST + SSE routes (sessions, agent, files, models, auth, skills, northstar).
- `lib/**` — server logic: `rpc-manager`, `session-reader`, `normalize`, `types`, `northstar/`.
- `components/**` — UI (`AppShell`, `ChatWindow`, `SessionSidebar`, `ChatInput`, `MessageView`, …).
- `hooks/**` — React hooks (`useAgentSession`, `useTheme`, `useDragDrop`, `useAudio`).
- `bin/pi-web.js` — published CLI: resolves next's entry, runs `next start`, opens the browser.
