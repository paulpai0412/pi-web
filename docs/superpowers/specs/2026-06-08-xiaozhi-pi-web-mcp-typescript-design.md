# Xiaozhi MCP TypeScript Adapter for pi-web Design

Date: 2026-06-08
Status: Draft for user review

## Goal

Expose selected `pi-web` chat and Northstar capabilities to Xiaozhi AI through Xiaozhi's WebSocket MCP endpoint, implemented entirely in TypeScript/Node.js. Do not use Python `mcp_pipe.py`.

The adapter lets Xiaozhi call MCP tools that operate the local `pi-web` server:

- Start and continue pi-web chat sessions.
- Read session state and history.
- List pi-web sessions.
- Inspect Northstar board, ready issues, issue details, and watch status.

Northstar mutation actions are intentionally out of the MVP and will be added later behind explicit preview/confirm gates.

## Non-goals

- Do not replace `pi-web`'s existing Next.js API.
- Do not expose arbitrary shell execution.
- Do not expose unrestricted filesystem access.
- Do not implement Python `mcp_pipe.py` or depend on Python.
- Do not implement token-by-token streaming in the first version.
- Do not mutate Northstar issues in the first version.

## Context from web research

Xiaozhi MCP examples commonly use a WebSocket MCP endpoint. Community examples such as `78/mcp-calculator` use a `mcp_pipe.py` bridge that connects to an endpoint like:

```text
ws://host:port/mcp/?token=...
wss://host/mcp/?token=...
```

The payloads are MCP-style JSON-RPC 2.0 messages using methods such as:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`
- `notifications/initialized`

Some Xiaozhi documentation also shows MCP JSON-RPC payloads wrapped inside a transport message:

```json
{
  "session_id": "...",
  "type": "mcp",
  "payload": {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }
}
```

The adapter should therefore support both raw JSON-RPC messages and wrapped `type: "mcp"` messages, replying in the same shape it received.

## Recommended architecture

```text
Xiaozhi AI / Xiaozhi MCP endpoint
        │
        │ WebSocket JSON-RPC
        ▼
pi-web-xiaozhi-mcp 〔TypeScript / Node.js〕
        │
        ├─ WebSocket connection / reconnect
        ├─ JSON-RPC request parsing
        ├─ MCP tool registry
        ├─ safety validation
        │
        ▼
pi-web local HTTP API
        │
        ├─ /api/agent/*
        ├─ /api/sessions/*
        └─ /api/northstar/*
```

The new process is a native TypeScript/Node.js adapter. It connects outbound to Xiaozhi's WebSocket endpoint and calls the local `pi-web` HTTP APIs. It does not directly import `lib/rpc-manager.ts`; this keeps the adapter decoupled from in-process Next.js state and preserves the existing API boundary.

## New CLI

Add a new binary later during implementation:

```text
bin/pi-web-xiaozhi-mcp.js
```

Expected usage:

```bash
# terminal 1
cd /home/timmypai/apps/pi-web
npm run dev

# terminal 2
export XIAOZHI_MCP_ENDPOINT="wss://example/mcp/?token=..."
export PI_WEB_BASE_URL="http://127.0.0.1:3030"
export PI_WEB_MCP_ALLOWED_ROOTS="/home/timmypai/apps"
export PI_WEB_MCP_DEFAULT_CWD="/home/timmypai/apps/pi-web"
node bin/pi-web-xiaozhi-mcp.js
```

## Proposed file layout

```text
bin/
  pi-web-xiaozhi-mcp.js

lib/xiaozhi-mcp/
  cli.ts
  websocket-client.ts
  json-rpc.ts
  tool-registry.ts
  pi-web-client.ts
  sse.ts
  safety.ts
  tools/
    chat.ts
    sessions.ts
    northstar-read.ts
```

Mutation tools should be implemented in a later phase as:

```text
lib/xiaozhi-mcp/tools/northstar-actions.ts
```

## Components

### `cli.ts`

Owns process startup:

- Read environment variables.
- Validate required configuration.
- Create the `PiWebClient`.
- Register MCP tools.
- Start the Xiaozhi WebSocket client.

### `websocket-client.ts`

Owns the connection to Xiaozhi:

- Connect to `XIAOZHI_MCP_ENDPOINT`.
- Receive text WebSocket messages.
- Parse each message as raw JSON-RPC or wrapped MCP payload.
- Dispatch requests to the MCP handler.
- Send responses back in the same shape.
- Reconnect with exponential backoff after connection loss.

Binary WebSocket frames are ignored in this adapter because the adapter only serves MCP tool requests, not Xiaozhi audio traffic.

### `json-rpc.ts`

Small local JSON-RPC 2.0 helpers:

- Validate request shape.
- Build success responses.
- Build error responses.
- Use standard error codes where practical:
  - `-32700` parse error
  - `-32600` invalid request
  - `-32601` method not found
  - `-32602` invalid params
  - `-32603` internal error

Supported methods for MVP:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`
- `notifications/initialized`

### `tool-registry.ts`

Defines and dispatches MCP tools:

```ts
interface XiaozhiMcpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  call(args: unknown): Promise<McpToolResult>;
}
```

`tools/list` returns tool metadata. `tools/call` validates the requested tool name and dispatches to the corresponding handler.

### `pi-web-client.ts`

HTTP client for local `pi-web` APIs. It should only use `PI_WEB_BASE_URL`, defaulting to `http://127.0.0.1:3030`.

Responsibilities:

- `createChatSession()` → `POST /api/agent/new`
- `sendChatMessage()` → `POST /api/agent/[id]`
- `getAgentState()` → `GET /api/agent/[id]`
- `readSession()` → `GET /api/sessions/[id]`
- `listSessions()` → `GET /api/sessions`
- `getNorthstarProjects()` → `GET /api/northstar/projects`
- `getNorthstarBoard()` → `GET /api/northstar/projects/[projectId]`
- `getNorthstarIssue()` → `GET /api/northstar/projects/[projectId]/issues/[issueId]`
- `getNorthstarIssueEvents()` → `GET /api/northstar/projects/[projectId]/issues/[issueId]/events`
- `getNorthstarWatchStatus()` → `GET /api/northstar/shell`

### `sse.ts`

Minimal stream helper for existing pi-web endpoints.

MVP behavior:

- `waitForAssistantMessage(sessionId, timeoutMs)` connects to `/api/agent/[id]/events`.
- It waits for `message_end` with assistant content.
- If a response arrives before timeout, return `completed` and answer text.
- If not, return `timeout` / `running` with the session id.

Do not attempt token-by-token forwarding in MVP.

### `safety.ts`

Centralizes safety checks:

- Resolve `~` and relative paths.
- Ensure cwd is inside `PI_WEB_MCP_ALLOWED_ROOTS`.
- Ensure Northstar config paths end in `.northstar.yaml`.
- Reject paths containing traversal segments.
- Map `toolsPreset` to allowed pi tool names.
- Enforce `PI_WEB_MCP_MAX_TOOLS_PRESET`.

## Environment variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `XIAOZHI_MCP_ENDPOINT` | yes | none | Xiaozhi WebSocket MCP endpoint. |
| `PI_WEB_BASE_URL` | no | `http://127.0.0.1:3030` | Local pi-web server URL. |
| `PI_WEB_MCP_ALLOWED_ROOTS` | yes | none | Comma-separated allowed filesystem roots. |
| `PI_WEB_MCP_DEFAULT_CWD` | no | first allowed root | Default cwd for tools that omit cwd. |
| `PI_WEB_MCP_MAX_TOOLS_PRESET` | no | `readonly` | Maximum allowed chat tool preset: `none`, `readonly`, `coding`. |
| `PI_WEB_MCP_LOG_LEVEL` | no | `info` | Logging verbosity. |

`PI_WEB_BASE_URL` should be restricted to localhost in MVP. Remote pi-web operation is out of scope.

## MCP message compatibility

### Raw JSON-RPC input

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/list",
  "params": {}
}
```

Response:

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "tools": []
  }
}
```

### Wrapped Xiaozhi MCP input

```json
{
  "session_id": "abc",
  "type": "mcp",
  "payload": {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list"
  }
}
```

Response:

```json
{
  "session_id": "abc",
  "type": "mcp",
  "payload": {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
      "tools": []
    }
  }
}
```

## Tool surface for MVP

### `pi_chat_start`

Starts a new pi-web chat session and sends the first user message.

Input:

```json
{
  "cwd": "/home/timmypai/apps/pi-web",
  "message": "幫我檢查目前專案狀態",
  "toolsPreset": "readonly",
  "thinkingLevel": "off",
  "waitSeconds": 60
}
```

Output:

```json
{
  "sessionId": "...",
  "status": "completed",
  "answer": "...",
  "piWebUrl": "http://127.0.0.1:3030?session=..."
}
```

`toolsPreset` maps to:

- `none` → `[]`
- `readonly` → `read`, `grep`, `find`, `ls`
- `coding` → `read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`

Default is `readonly`.

### `pi_chat_send`

Sends a follow-up message to an existing session.

Input:

```json
{
  "sessionId": "...",
  "message": "繼續",
  "waitSeconds": 60
}
```

Output:

```json
{
  "sessionId": "...",
  "status": "completed",
  "answer": "..."
}
```

### `pi_chat_state`

Reads current agent state.

Input:

```json
{
  "sessionId": "..."
}
```

### `pi_chat_read`

Reads session history.

Input:

```json
{
  "sessionId": "...",
  "limit": 20
}
```

### `pi_chat_abort`

Aborts a running chat session.

Input:

```json
{
  "sessionId": "..."
}
```

### `pi_sessions_list`

Lists pi-web sessions, optionally filtered and limited by the adapter after fetching.

Input:

```json
{
  "cwd": "/home/timmypai/apps/pi-web",
  "limit": 20
}
```

### `northstar_ready_issues`

Lists ready Northstar issues for a cwd.

Input:

```json
{
  "cwd": "/home/timmypai/apps/pi-web"
}
```

The tool resolves the config path to `<cwd>/.northstar.yaml`, fetches the project list and board, and returns cards whose lifecycle is `ready`.

### `northstar_issue_detail`

Reads one issue detail and event history.

Input:

```json
{
  "cwd": "/home/timmypai/apps/pi-web",
  "projectId": "...",
  "issueId": "15"
}
```

### `northstar_watch_status`

Returns the current Northstar watch process status.

Input:

```json
{
  "cwd": "/home/timmypai/apps/pi-web"
}
```

## Deferred Northstar mutation design

Mutation tools are not part of MVP. When added, they must use a preview/confirm flow.

### `northstar_action_preview`

Creates a pending confirmation record and returns risk plus command preview.

Input:

```json
{
  "cwd": "/home/timmypai/apps/pi-web",
  "projectId": "...",
  "issueId": "15",
  "action": "start"
}
```

Output:

```json
{
  "requiresConfirmation": true,
  "confirmationId": "confirm_...",
  "risk": "low",
  "commandPreview": "northstar start --issue 15 --config /home/timmypai/apps/pi-web/.northstar.yaml",
  "expectedEffect": "Starts the Northstar worker for issue 15."
}
```

### `northstar_action_confirm`

Executes a previously previewed action by confirmation id. The confirmation record must expire quickly and must include the exact action, issue, project, and config path. The confirm call must not accept a new command string.

## Data flow examples

### Start chat

```text
Xiaozhi → WebSocket → tools/call pi_chat_start
adapter → POST /api/agent/new
adapter → GET /api/agent/{id}/events
adapter waits for assistant message_end or timeout
adapter → WebSocket response with sessionId and answer/status
```

### Read ready issues

```text
Xiaozhi → tools/call northstar_ready_issues
adapter validates cwd
adapter computes /home/timmypai/apps/pi-web/.northstar.yaml
adapter → GET /api/northstar/projects?config=...
adapter → GET /api/northstar/projects/{projectId}?config=...
adapter filters ready cards
adapter → WebSocket response
```

## Error handling

- Invalid JSON → JSON-RPC parse error if possible, otherwise log and ignore.
- Unsupported method → JSON-RPC `-32601`.
- Unknown tool → JSON-RPC `-32602` or MCP tool result with `isError: true`.
- Invalid cwd/config → MCP tool result with `isError: true` and a concise message.
- pi-web unavailable → MCP tool result with `isError: true`, message says local pi-web is unreachable.
- Chat timeout → successful tool result with `status: "timeout"` and `sessionId`, not a protocol error.
- WebSocket disconnect → reconnect with backoff; no in-memory request replay in MVP.

## Security model

1. `PI_WEB_MCP_ALLOWED_ROOTS` is mandatory.
2. All cwd and config paths must resolve under an allowed root.
3. `PI_WEB_BASE_URL` defaults to localhost; remote base URLs are out of scope.
4. `toolsPreset` defaults to `readonly`.
5. `coding` tools can be disabled globally by setting `PI_WEB_MCP_MAX_TOOLS_PRESET=readonly`.
6. No arbitrary shell tool is exposed.
7. Northstar mutation actions are deferred and must use preview/confirm.
8. Logs should redact obvious secrets in URLs, especially `token=` query parameters.

## Testing strategy

### Unit tests

- JSON-RPC raw request parsing and response generation.
- Wrapped Xiaozhi MCP parsing and response wrapping.
- Tool registry unknown tool handling.
- cwd allowlist acceptance/rejection.
- `toolsPreset` mapping and max-preset enforcement.
- Northstar config path validation.

### Integration tests with mocked pi-web API

- `pi_chat_start` returns completed when mocked SSE emits assistant `message_end`.
- `pi_chat_start` returns timeout when mocked SSE does not finish.
- `pi_chat_send` posts correct payload to `/api/agent/[id]`.
- `northstar_ready_issues` fetches projects/board and filters ready cards.
- pi-web unavailable returns `isError: true` instead of crashing.

### Manual verification

1. Start pi-web with `npm run dev` on port 3030.
2. Run the adapter with a test Xiaozhi MCP endpoint.
3. Confirm Xiaozhi can discover tools via `tools/list`.
4. Call `pi_chat_start` from Xiaozhi and verify a session appears in pi-web.
5. Call `northstar_ready_issues` against a cwd with `.northstar.yaml`.

Do not run `next build` during development.

## Implementation phases

### Phase 1: Protocol shell

- CLI entrypoint.
- WebSocket connect/reconnect.
- Raw and wrapped JSON-RPC support.
- `initialize`, `ping`, `tools/list`, `tools/call`.
- Basic tool registry with one test tool.

### Phase 2: pi-web chat/session tools

- `PiWebClient`.
- SSE wait helper.
- `pi_chat_start`.
- `pi_chat_send`.
- `pi_chat_state`.
- `pi_chat_read`.
- `pi_chat_abort`.
- `pi_sessions_list`.

### Phase 3: Northstar read-only tools

- `northstar_ready_issues`.
- `northstar_issue_detail`.
- `northstar_watch_status`.

### Phase 4: Documentation and examples

- Add setup documentation.
- Document environment variables.
- Include sample Xiaozhi endpoint startup commands.
- Include troubleshooting for pi-web unavailable, invalid endpoint, and cwd allowlist failures.

### Later phase: Northstar mutation tools

- `northstar_action_preview`.
- `northstar_action_confirm`.
- Expiring confirmation store.
- Execution result summarization.

## Open questions

1. Exact Xiaozhi WebSocket endpoint format and auth will be validated with a real endpoint during implementation.
2. Whether Xiaozhi sends raw JSON-RPC or wrapped MCP messages will be confirmed by logging first inbound messages; the adapter supports both by design.
3. Whether Xiaozhi expects `initialize` protocol version `2024-11-05` or a newer value will be verified; MVP can return a conservative MCP-compatible version and server info.

## Acceptance criteria

- No Python dependency is required.
- Adapter connects to a configured Xiaozhi WebSocket endpoint.
- `tools/list` returns the MVP tools.
- `pi_chat_start` creates a pi-web session and returns either assistant answer or running/timeout status.
- `pi_chat_send` continues an existing session.
- `pi_chat_read` and `pi_chat_state` return session data.
- `northstar_ready_issues` returns ready cards for a valid Northstar cwd.
- Invalid cwd outside allowed roots is rejected.
- Secrets in endpoint URLs are not printed in full logs.
- TypeScript typecheck passes.
