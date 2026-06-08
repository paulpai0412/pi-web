# Xiaozhi Pi-Web MCP TypeScript Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a TypeScript/Node.js Xiaozhi MCP WebSocket adapter that exposes selected local pi-web chat/session and Northstar read-only tools without Python.

**Architecture:** Add a new `pi-web-xiaozhi-mcp` CLI that connects outbound to Xiaozhi's WebSocket MCP endpoint, parses raw or wrapped JSON-RPC, dispatches MCP tools through a focused registry, and calls existing local pi-web HTTP/SSE APIs. Keep all state and safety checks inside `lib/xiaozhi-mcp/`; do not import `lib/rpc-manager.ts` or mutate Next.js internals.

**Tech Stack:** TypeScript, Node.js, `ws`, built-in `fetch`, built-in `node:test`, `tsx` for TS test/runtime loading, existing Next.js API routes.

---

## Scope and sequencing

This plan implements the approved MVP only:

- Protocol: `initialize`, `ping`, `tools/list`, `tools/call`, `notifications/initialized`.
- Message forms: raw JSON-RPC and wrapped `{ type: "mcp", payload }`.
- Tools: `pi_chat_start`, `pi_chat_send`, `pi_chat_state`, `pi_chat_read`, `pi_chat_abort`, `pi_sessions_list`, `northstar_ready_issues`, `northstar_issue_detail`, `northstar_watch_status`.
- Safety: mandatory allowed roots, localhost-ish pi-web base URL, tool preset limit, config validation, token redaction in logs.

Not implemented in this plan:

- Northstar mutation tools.
- Arbitrary shell execution.
- Token-by-token MCP streaming.

## File structure

Create these focused files:

- `lib/xiaozhi-mcp/json-rpc.ts` — JSON-RPC types, parse/wrap helpers, response builders.
- `lib/xiaozhi-mcp/safety.ts` — cwd/config/base URL/tool preset validation.
- `lib/xiaozhi-mcp/tool-registry.ts` — MCP tool interface and dispatcher.
- `lib/xiaozhi-mcp/pi-web-client.ts` — local pi-web REST client.
- `lib/xiaozhi-mcp/sse.ts` — minimal SSE reader for assistant `message_end`.
- `lib/xiaozhi-mcp/tools/chat.ts` — pi chat/session tools.
- `lib/xiaozhi-mcp/tools/northstar-read.ts` — Northstar read-only tools.
- `lib/xiaozhi-mcp/websocket-client.ts` — Xiaozhi WebSocket connect/reconnect loop.
- `lib/xiaozhi-mcp/cli.ts` — env parsing, registry setup, startup.
- `bin/pi-web-xiaozhi-mcp.js` — published Node CLI wrapper.
- `docs/xiaozhi-mcp.md` — operator setup and troubleshooting.

Create tests:

- `tests/xiaozhi-mcp/json-rpc.test.ts`
- `tests/xiaozhi-mcp/safety.test.ts`
- `tests/xiaozhi-mcp/tool-registry.test.ts`
- `tests/xiaozhi-mcp/pi-web-client.test.ts`
- `tests/xiaozhi-mcp/tools.test.ts`
- `tests/xiaozhi-mcp/websocket-client.test.ts`

Modify:

- `package.json` — add `pi-web-xiaozhi-mcp` bin and one test script.

---

### Task 1: JSON-RPC core and Xiaozhi message wrapping

**Files:**
- Create: `tests/xiaozhi-mcp/json-rpc.test.ts`
- Create: `lib/xiaozhi-mcp/json-rpc.ts`

- [ ] **Step 1: Write the failing JSON-RPC tests**

Create `tests/xiaozhi-mcp/json-rpc.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildError,
  buildResult,
  parseIncomingMessage,
  unwrapIncomingMessage,
  wrapOutgoingMessage,
} from "../../lib/xiaozhi-mcp/json-rpc";

test("parses raw JSON-RPC request text", () => {
  const parsed = parseIncomingMessage(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }));
  assert.equal(parsed.kind, "raw");
  assert.deepEqual(parsed.payload, { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
});

test("parses wrapped Xiaozhi MCP request text", () => {
  const parsed = parseIncomingMessage(JSON.stringify({
    session_id: "s1",
    type: "mcp",
    payload: { jsonrpc: "2.0", id: "abc", method: "tools/call", params: { name: "x" } },
  }));
  assert.equal(parsed.kind, "wrapped");
  assert.equal(parsed.sessionId, "s1");
  assert.deepEqual(parsed.payload, { jsonrpc: "2.0", id: "abc", method: "tools/call", params: { name: "x" } });
});

test("unwrapIncomingMessage validates request shape", () => {
  const incoming = unwrapIncomingMessage({ kind: "raw", payload: { jsonrpc: "2.0", id: 7, method: "ping" } });
  assert.equal(incoming.valid, true);
  if (incoming.valid) assert.equal(incoming.request.method, "ping");

  const invalid = unwrapIncomingMessage({ kind: "raw", payload: { jsonrpc: "2.0", id: 7 } });
  assert.equal(invalid.valid, false);
  if (!invalid.valid) assert.equal(invalid.error.error.code, -32600);
});

test("wrapOutgoingMessage preserves raw or wrapped shape", () => {
  const response = buildResult(1, { ok: true });
  assert.deepEqual(wrapOutgoingMessage({ kind: "raw", payload: {} }, response), response);
  assert.deepEqual(wrapOutgoingMessage({ kind: "wrapped", sessionId: "s1", payload: {} }, response), {
    session_id: "s1",
    type: "mcp",
    payload: response,
  });
});

test("buildError creates standard JSON-RPC error response", () => {
  assert.deepEqual(buildError("r1", -32601, "No method"), {
    jsonrpc: "2.0",
    id: "r1",
    error: { code: -32601, message: "No method" },
  });
});
```

- [ ] **Step 2: Run the failing JSON-RPC tests**

Run:

```bash
node --import tsx --test tests/xiaozhi-mcp/json-rpc.test.ts
```

Expected: FAIL because `lib/xiaozhi-mcp/json-rpc.ts` does not exist.

- [ ] **Step 3: Implement `json-rpc.ts`**

Create `lib/xiaozhi-mcp/json-rpc.ts`:

```ts
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue; }

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: JsonValue;
}

export interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result: JsonValue;
}

export interface JsonRpcFailure {
  jsonrpc: "2.0";
  id: JsonRpcId;
  error: {
    code: number;
    message: string;
    data?: JsonValue;
  };
}

export type JsonRpcResponse = JsonRpcSuccess | JsonRpcFailure;

export type IncomingEnvelope =
  | { kind: "raw"; payload: unknown }
  | { kind: "wrapped"; sessionId?: string; payload: unknown };

export type ValidatedIncoming =
  | { valid: true; request: JsonRpcRequest }
  | { valid: false; error: JsonRpcFailure };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;
  if (["string", "number", "boolean"].includes(typeof value)) return value as JsonPrimitive;
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (isObject(value)) {
    const out: JsonObject = {};
    for (const [key, item] of Object.entries(value)) out[key] = toJsonValue(item);
    return out;
  }
  return String(value);
}

export function parseIncomingMessage(text: string): IncomingEnvelope {
  const value = JSON.parse(text) as unknown;
  if (isObject(value) && value.type === "mcp" && "payload" in value) {
    return {
      kind: "wrapped",
      sessionId: typeof value.session_id === "string" ? value.session_id : undefined,
      payload: value.payload,
    };
  }
  return { kind: "raw", payload: value };
}

export function buildResult(id: JsonRpcId | undefined, result: unknown): JsonRpcSuccess {
  return { jsonrpc: "2.0", id: id ?? null, result: toJsonValue(result) };
}

export function buildError(id: JsonRpcId | undefined, code: number, message: string, data?: unknown): JsonRpcFailure {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: {
      code,
      message,
      ...(data === undefined ? {} : { data: toJsonValue(data) }),
    },
  };
}

export function unwrapIncomingMessage(envelope: IncomingEnvelope): ValidatedIncoming {
  const payload = envelope.payload;
  if (!isObject(payload) || payload.jsonrpc !== "2.0" || typeof payload.method !== "string") {
    const id = isObject(payload) && (typeof payload.id === "string" || typeof payload.id === "number" || payload.id === null)
      ? payload.id
      : null;
    return { valid: false, error: buildError(id, -32600, "Invalid JSON-RPC request") };
  }

  const id = typeof payload.id === "string" || typeof payload.id === "number" || payload.id === null
    ? payload.id
    : undefined;

  return {
    valid: true,
    request: {
      jsonrpc: "2.0",
      ...(id !== undefined ? { id } : {}),
      method: payload.method,
      ...("params" in payload ? { params: toJsonValue(payload.params) } : {}),
    },
  };
}

export function wrapOutgoingMessage(envelope: IncomingEnvelope, response: JsonRpcResponse): unknown {
  if (envelope.kind === "wrapped") {
    return {
      ...(envelope.sessionId ? { session_id: envelope.sessionId } : {}),
      type: "mcp",
      payload: response,
    };
  }
  return response;
}

export function stringifyOutgoingMessage(message: unknown): string {
  return JSON.stringify(message);
}
```

- [ ] **Step 4: Run JSON-RPC tests until they pass**

Run:

```bash
node --import tsx --test tests/xiaozhi-mcp/json-rpc.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add lib/xiaozhi-mcp/json-rpc.ts tests/xiaozhi-mcp/json-rpc.test.ts
git commit -m "feat(xiaozhi-mcp): add json-rpc message helpers"
```

---

### Task 2: Safety validation

**Files:**
- Create: `tests/xiaozhi-mcp/safety.test.ts`
- Create: `lib/xiaozhi-mcp/safety.ts`

- [ ] **Step 1: Write failing safety tests**

Create `tests/xiaozhi-mcp/safety.test.ts`:

```ts
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";

import {
  assertLocalPiWebBaseUrl,
  configFromCwd,
  mapToolsPreset,
  redactSecrets,
  resolveAllowedPath,
} from "../../lib/xiaozhi-mcp/safety";

test("resolveAllowedPath accepts paths under allowed roots", () => {
  const root = resolve(homedir(), "apps");
  assert.equal(resolveAllowedPath("~/apps/pi-web", [root]), resolve(root, "pi-web"));
});

test("resolveAllowedPath rejects paths outside allowed roots", () => {
  assert.throws(() => resolveAllowedPath("/etc", [resolve(homedir(), "apps")]), /outside allowed roots/);
});

test("configFromCwd returns a .northstar.yaml path under cwd", () => {
  const cwd = resolve(homedir(), "apps/pi-web");
  assert.equal(configFromCwd(cwd, [resolve(homedir(), "apps")]), resolve(cwd, ".northstar.yaml"));
});

test("mapToolsPreset enforces max preset", () => {
  assert.deepEqual(mapToolsPreset("none", "readonly"), []);
  assert.deepEqual(mapToolsPreset("readonly", "readonly"), ["read", "grep", "find", "ls"]);
  assert.throws(() => mapToolsPreset("coding", "readonly"), /exceeds maximum/);
  assert.deepEqual(mapToolsPreset("coding", "coding"), ["read", "bash", "edit", "write", "grep", "find", "ls"]);
});

test("assertLocalPiWebBaseUrl accepts localhost and rejects remote hosts", () => {
  assert.equal(assertLocalPiWebBaseUrl("http://127.0.0.1:3030"), "http://127.0.0.1:3030");
  assert.equal(assertLocalPiWebBaseUrl("http://localhost:3030"), "http://localhost:3030");
  assert.throws(() => assertLocalPiWebBaseUrl("https://example.com"), /localhost/);
});

test("redactSecrets removes token query values", () => {
  assert.equal(redactSecrets("wss://x/mcp/?token=abc123&name=ok"), "wss://x/mcp/?token=REDACTED&name=ok");
});
```

- [ ] **Step 2: Run the failing safety tests**

Run:

```bash
node --import tsx --test tests/xiaozhi-mcp/safety.test.ts
```

Expected: FAIL because `safety.ts` does not exist.

- [ ] **Step 3: Implement `safety.ts`**

Create `lib/xiaozhi-mcp/safety.ts`:

```ts
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve, sep } from "node:path";

export type ToolsPreset = "none" | "readonly" | "coding";

const PRESET_RANK: Record<ToolsPreset, number> = { none: 0, readonly: 1, coding: 2 };

export function expandHome(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) return resolve(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

function normalizeRoot(root: string): string {
  return expandHome(root).replace(/[\\/]+$/, "");
}

function isInside(candidate: string, root: string): boolean {
  const normalizedRoot = normalizeRoot(root);
  return candidate === normalizedRoot || candidate.startsWith(normalizedRoot + sep);
}

export function parseAllowedRoots(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(normalizeRoot);
}

export function resolveAllowedPath(input: string, allowedRoots: string[]): string {
  if (allowedRoots.length === 0) throw new Error("PI_WEB_MCP_ALLOWED_ROOTS is required");
  if (input.includes("..")) throw new Error("Path traversal is not allowed");
  const resolved = expandHome(input);
  if (!allowedRoots.some((root) => isInside(resolved, root))) {
    throw new Error(`Path is outside allowed roots: ${input}`);
  }
  return resolved;
}

export function configFromCwd(cwd: string, allowedRoots: string[]): string {
  const resolvedCwd = resolveAllowedPath(cwd, allowedRoots);
  return resolve(resolvedCwd, ".northstar.yaml");
}

export function validateNorthstarConfig(config: string, allowedRoots: string[], requireExists = false): string {
  if (config.includes("..")) throw new Error("Invalid config path");
  if (!config.endsWith(".northstar.yaml")) throw new Error("config must be a .northstar.yaml file");
  const resolved = resolveAllowedPath(config, allowedRoots);
  if (requireExists && !existsSync(resolved)) throw new Error("Config file not found");
  return resolved;
}

export function mapToolsPreset(requested: unknown, maxPreset: ToolsPreset): string[] {
  const preset = typeof requested === "string" && ["none", "readonly", "coding"].includes(requested)
    ? requested as ToolsPreset
    : "readonly";
  if (PRESET_RANK[preset] > PRESET_RANK[maxPreset]) {
    throw new Error(`toolsPreset ${preset} exceeds maximum ${maxPreset}`);
  }
  if (preset === "none") return [];
  if (preset === "readonly") return ["read", "grep", "find", "ls"];
  return ["read", "bash", "edit", "write", "grep", "find", "ls"];
}

export function parseMaxToolsPreset(value: string | undefined): ToolsPreset {
  if (value === "none" || value === "readonly" || value === "coding") return value;
  return "readonly";
}

export function assertLocalPiWebBaseUrl(value: string | undefined): string {
  const url = new URL(value || "http://127.0.0.1:3030");
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("PI_WEB_BASE_URL must be http or https");
  if (!["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("PI_WEB_BASE_URL must point to localhost in the MVP");
  }
  return url.toString().replace(/\/$/, "");
}

export function redactSecrets(text: string): string {
  return text.replace(/([?&](?:token|access_token|key|api_key)=)[^&\s]+/gi, "$1REDACTED");
}
```

- [ ] **Step 4: Run safety tests until they pass**

Run:

```bash
node --import tsx --test tests/xiaozhi-mcp/safety.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add lib/xiaozhi-mcp/safety.ts tests/xiaozhi-mcp/safety.test.ts
git commit -m "feat(xiaozhi-mcp): add adapter safety checks"
```

---

### Task 3: MCP tool registry and method dispatch

**Files:**
- Create: `tests/xiaozhi-mcp/tool-registry.test.ts`
- Create: `lib/xiaozhi-mcp/tool-registry.ts`

- [ ] **Step 1: Write failing registry tests**

Create `tests/xiaozhi-mcp/tool-registry.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { createMcpHandler, createToolRegistry } from "../../lib/xiaozhi-mcp/tool-registry";

test("tools/list returns registered tool schemas", async () => {
  const registry = createToolRegistry();
  registry.register({
    name: "echo",
    description: "Echo input",
    inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
    call: async (args) => ({ content: [{ type: "text", text: JSON.stringify(args) }] }),
  });

  const handler = createMcpHandler(registry);
  const response = await handler({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 1,
    result: {
      tools: [{
        name: "echo",
        description: "Echo input",
        inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
      }],
    },
  });
});

test("tools/call dispatches registered tool", async () => {
  const registry = createToolRegistry();
  registry.register({
    name: "echo",
    description: "Echo input",
    inputSchema: { type: "object" },
    call: async (args) => ({ content: [{ type: "text", text: `ok:${(args as { text: string }).text}` }] }),
  });

  const handler = createMcpHandler(registry);
  const response = await handler({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } });
  assert.deepEqual(response, {
    jsonrpc: "2.0",
    id: 2,
    result: { content: [{ type: "text", text: "ok:hi" }] },
  });
});

test("initialize and ping return valid results", async () => {
  const handler = createMcpHandler(createToolRegistry());
  const init = await handler({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  assert.equal(init.jsonrpc, "2.0");
  assert.equal("result" in init, true);
  if ("result" in init) assert.match(JSON.stringify(init.result), /pi-web-xiaozhi-mcp/);

  const ping = await handler({ jsonrpc: "2.0", id: 2, method: "ping" });
  assert.deepEqual(ping, { jsonrpc: "2.0", id: 2, result: {} });
});

test("unknown tools and methods return JSON-RPC errors", async () => {
  const handler = createMcpHandler(createToolRegistry());
  const unknownMethod = await handler({ jsonrpc: "2.0", id: 1, method: "resources/list" });
  assert.equal("error" in unknownMethod, true);
  if ("error" in unknownMethod) assert.equal(unknownMethod.error.code, -32601);

  const unknownTool = await handler({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "missing" } });
  assert.equal("error" in unknownTool, true);
  if ("error" in unknownTool) assert.equal(unknownTool.error.code, -32602);
});
```

- [ ] **Step 2: Run the failing registry tests**

Run:

```bash
node --import tsx --test tests/xiaozhi-mcp/tool-registry.test.ts
```

Expected: FAIL because `tool-registry.ts` does not exist.

- [ ] **Step 3: Implement `tool-registry.ts`**

Create `lib/xiaozhi-mcp/tool-registry.ts`:

```ts
import { buildError, buildResult, type JsonObject, type JsonRpcRequest, type JsonRpcResponse, type JsonValue } from "./json-rpc";

export interface McpTextContent {
  type: "text";
  text: string;
}

export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

export interface XiaozhiMcpTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
  call(args: unknown): Promise<McpToolResult>;
}

export interface ToolRegistry {
  register(tool: XiaozhiMcpTool): void;
  list(): XiaozhiMcpTool[];
  call(name: string, args: unknown): Promise<McpToolResult>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function textResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

export function jsonTextResult(value: unknown): McpToolResult {
  return textResult(JSON.stringify(value, null, 2));
}

export function errorTextResult(message: string): McpToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function createToolRegistry(): ToolRegistry {
  const tools = new Map<string, XiaozhiMcpTool>();
  return {
    register(tool) {
      if (tools.has(tool.name)) throw new Error(`Duplicate MCP tool: ${tool.name}`);
      tools.set(tool.name, tool);
    },
    list() {
      return [...tools.values()];
    },
    async call(name, args) {
      const tool = tools.get(name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return tool.call(args);
    },
  };
}

export function createMcpHandler(registry: ToolRegistry): (request: JsonRpcRequest) => Promise<JsonRpcResponse | undefined> {
  return async (request) => {
    if (request.method === "notifications/initialized") return undefined;

    if (request.method === "initialize") {
      return buildResult(request.id, {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "pi-web-xiaozhi-mcp", version: "0.1.0" },
      });
    }

    if (request.method === "ping") return buildResult(request.id, {});

    if (request.method === "tools/list") {
      return buildResult(request.id, {
        tools: registry.list().map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });
    }

    if (request.method === "tools/call") {
      if (!isObject(request.params) || typeof request.params.name !== "string") {
        return buildError(request.id, -32602, "tools/call requires params.name");
      }
      try {
        const result = await registry.call(request.params.name, request.params.arguments);
        return buildResult(request.id, result as unknown as JsonValue);
      } catch (error) {
        return buildError(request.id, -32602, error instanceof Error ? error.message : String(error));
      }
    }

    return buildError(request.id, -32601, `Unsupported method: ${request.method}`);
  };
}
```

- [ ] **Step 4: Run registry tests until they pass**

Run:

```bash
node --import tsx --test tests/xiaozhi-mcp/tool-registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add lib/xiaozhi-mcp/tool-registry.ts tests/xiaozhi-mcp/tool-registry.test.ts
git commit -m "feat(xiaozhi-mcp): add mcp tool registry"
```

---

### Task 4: pi-web HTTP client and SSE wait helper

**Files:**
- Create: `tests/xiaozhi-mcp/pi-web-client.test.ts`
- Create: `lib/xiaozhi-mcp/pi-web-client.ts`
- Create: `lib/xiaozhi-mcp/sse.ts`

- [ ] **Step 1: Write failing pi-web client tests**

Create `tests/xiaozhi-mcp/pi-web-client.test.ts`:

```ts
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

import { PiWebClient } from "../../lib/xiaozhi-mcp/pi-web-client";
import { waitForAssistantMessage } from "../../lib/xiaozhi-mcp/sse";

function startServer(handler: Parameters<typeof createServer>[0]): Promise<{ baseUrl: string; close(): Promise<void> }> {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Unexpected address");
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

test("PiWebClient creates chat sessions and sends commands", async () => {
  const seen: Array<{ method: string; url: string; body: unknown }> = [];
  const server = await startServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => {
      const bodyText = Buffer.concat(chunks).toString("utf8");
      seen.push({ method: req.method ?? "", url: req.url ?? "", body: bodyText ? JSON.parse(bodyText) : null });
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/agent/new") res.end(JSON.stringify({ success: true, sessionId: "s1", cwd: "/tmp", data: null }));
      else if (req.url === "/api/agent/s1") res.end(JSON.stringify({ success: true, data: null }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });

  try {
    const client = new PiWebClient(server.baseUrl);
    assert.equal((await client.createChatSession({ cwd: "/tmp", message: "hi", toolNames: [] })).sessionId, "s1");
    await client.sendAgentCommand("s1", { type: "prompt", message: "again" });
    assert.deepEqual(seen.map((item) => [item.method, item.url]), [["POST", "/api/agent/new"], ["POST", "/api/agent/s1"]]);
  } finally {
    await server.close();
  }
});

test("waitForAssistantMessage returns assistant message_end text", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } })}\n\n`);
    res.end();
  });

  try {
    const result = await waitForAssistantMessage(server.baseUrl, "s1", 1000);
    assert.deepEqual(result, { status: "completed", answer: "hello" });
  } finally {
    await server.close();
  }
});

test("waitForAssistantMessage returns timeout when no assistant message arrives", async () => {
  const server = await startServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  });

  try {
    const result = await waitForAssistantMessage(server.baseUrl, "s1", 25);
    assert.deepEqual(result, { status: "timeout" });
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: Run the failing pi-web client tests**

Run:

```bash
node --import tsx --test tests/xiaozhi-mcp/pi-web-client.test.ts
```

Expected: FAIL because `pi-web-client.ts` and `sse.ts` do not exist.

- [ ] **Step 3: Implement `pi-web-client.ts`**

Create `lib/xiaozhi-mcp/pi-web-client.ts`:

```ts
export interface CreateChatSessionInput {
  cwd: string;
  message: string;
  toolNames: string[];
  thinkingLevel?: string;
}

export interface CreateChatSessionResult {
  sessionId: string;
  cwd: string;
  data: unknown;
}

export class PiWebClient {
  constructor(public readonly baseUrl: string) {}

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }

  private async readJson<T>(response: Response): Promise<T> {
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const message = data && typeof data === "object" && "error" in data ? String((data as { error: unknown }).error) : response.statusText;
      throw new Error(message);
    }
    return data as T;
  }

  async createChatSession(input: CreateChatSessionInput): Promise<CreateChatSessionResult> {
    const response = await fetch(this.url("/api/agent/new"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cwd: input.cwd,
        type: "prompt",
        message: input.message,
        toolNames: input.toolNames,
        ...(input.thinkingLevel ? { thinkingLevel: input.thinkingLevel } : {}),
      }),
    });
    const data = await this.readJson<{ sessionId: string; cwd: string; data: unknown }>(response);
    return { sessionId: data.sessionId, cwd: data.cwd, data: data.data };
  }

  async sendAgentCommand(sessionId: string, command: Record<string, unknown>): Promise<unknown> {
    const response = await fetch(this.url(`/api/agent/${encodeURIComponent(sessionId)}`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
    });
    return this.readJson<unknown>(response);
  }

  async getAgentState(sessionId: string): Promise<unknown> {
    const response = await fetch(this.url(`/api/agent/${encodeURIComponent(sessionId)}`));
    return this.readJson<unknown>(response);
  }

  async readSession(sessionId: string): Promise<unknown> {
    const response = await fetch(this.url(`/api/sessions/${encodeURIComponent(sessionId)}?includeState=1`));
    return this.readJson<unknown>(response);
  }

  async listSessions(): Promise<unknown> {
    const response = await fetch(this.url("/api/sessions"));
    return this.readJson<unknown>(response);
  }

  async getNorthstarProjects(config: string): Promise<unknown> {
    const response = await fetch(this.url(`/api/northstar/projects?config=${encodeURIComponent(config)}`));
    return this.readJson<unknown>(response);
  }

  async getNorthstarBoard(projectId: string, config: string): Promise<unknown> {
    const response = await fetch(this.url(`/api/northstar/projects/${encodeURIComponent(projectId)}?config=${encodeURIComponent(config)}`));
    return this.readJson<unknown>(response);
  }

  async getNorthstarIssue(projectId: string, issueId: string, config: string): Promise<unknown> {
    const response = await fetch(this.url(`/api/northstar/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}?config=${encodeURIComponent(config)}`));
    return this.readJson<unknown>(response);
  }

  async getNorthstarIssueEvents(projectId: string, issueId: string, config: string): Promise<unknown> {
    const response = await fetch(this.url(`/api/northstar/projects/${encodeURIComponent(projectId)}/issues/${encodeURIComponent(issueId)}/events?config=${encodeURIComponent(config)}`));
    return this.readJson<unknown>(response);
  }

  async getNorthstarWatchStatus(config: string): Promise<unknown> {
    const response = await fetch(this.url(`/api/northstar/shell?config=${encodeURIComponent(config)}`));
    return this.readJson<unknown>(response);
  }
}
```

- [ ] **Step 4: Implement `sse.ts`**

Create `lib/xiaozhi-mcp/sse.ts`:

```ts
export type AssistantWaitResult =
  | { status: "completed"; answer: string }
  | { status: "timeout" }
  | { status: "running" };

function assistantTextFromMessage(message: unknown): string | null {
  if (!message || typeof message !== "object") return null;
  const msg = message as { role?: unknown; content?: unknown };
  if (msg.role !== "assistant") return null;
  if (typeof msg.content === "string") return msg.content;
  if (Array.isArray(msg.content)) {
    return msg.content
      .map((part) => part && typeof part === "object" && (part as { type?: unknown }).type === "text" ? String((part as { text?: unknown }).text ?? "") : "")
      .filter(Boolean)
      .join("\n") || null;
  }
  return null;
}

export async function waitForAssistantMessage(baseUrl: string, sessionId: string, timeoutMs: number): Promise<AssistantWaitResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, timeoutMs));

  try {
    const response = await fetch(`${baseUrl}/api/agent/${encodeURIComponent(sessionId)}/events`, { signal: controller.signal });
    if (!response.ok || !response.body) return { status: "running" };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";

      for (const eventText of events) {
        const dataLine = eventText.split("\n").find((line) => line.startsWith("data: "));
        if (!dataLine) continue;
        const event = JSON.parse(dataLine.slice(6)) as { type?: string; message?: unknown };
        if (event.type === "message_end") {
          const answer = assistantTextFromMessage(event.message);
          if (answer) return { status: "completed", answer };
        }
      }
    }

    return { status: "running" };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { status: "timeout" };
    throw error;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
```

- [ ] **Step 5: Run pi-web client tests until they pass**

Run:

```bash
node --import tsx --test tests/xiaozhi-mcp/pi-web-client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add lib/xiaozhi-mcp/pi-web-client.ts lib/xiaozhi-mcp/sse.ts tests/xiaozhi-mcp/pi-web-client.test.ts
git commit -m "feat(xiaozhi-mcp): add pi-web client and sse helper"
```

---

### Task 5: Chat, session, and Northstar read-only tools

**Files:**
- Create: `tests/xiaozhi-mcp/tools.test.ts`
- Create: `lib/xiaozhi-mcp/tools/chat.ts`
- Create: `lib/xiaozhi-mcp/tools/northstar-read.ts`

- [ ] **Step 1: Write failing tool tests**

Create `tests/xiaozhi-mcp/tools.test.ts`:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";

import { createChatTools } from "../../lib/xiaozhi-mcp/tools/chat";
import { createNorthstarReadTools } from "../../lib/xiaozhi-mcp/tools/northstar-read";

class FakeClient {
  created: unknown[] = [];
  sent: unknown[] = [];
  async createChatSession(input: unknown) { this.created.push(input); return { sessionId: "s1", cwd: "/home/me/apps/pi-web", data: null }; }
  async sendAgentCommand(sessionId: string, command: unknown) { this.sent.push({ sessionId, command }); return { success: true }; }
  async getAgentState(sessionId: string) { return { running: true, sessionId }; }
  async readSession(sessionId: string) { return { sessionId, context: { messages: [{ role: "user", content: "hi" }] } }; }
  async listSessions() { return { sessions: [{ id: "s1", cwd: "/home/me/apps/pi-web" }, { id: "s2", cwd: "/other" }] }; }
  async getNorthstarProjects() { return { projects: [{ projectId: "p1" }] }; }
  async getNorthstarBoard() { return { groups: [{ lifecycle: "ready", cards: [{ issueId: "15", title: "Ready work", lifecycle: "ready" }] }] }; }
  async getNorthstarIssue() { return { issue: { title: "Ready work" } }; }
  async getNorthstarIssueEvents() { return { events: [{ summary: "created" }] }; }
  async getNorthstarWatchStatus() { return { running: false }; }
}

const safety = {
  allowedRoots: ["/home/me/apps"],
  defaultCwd: "/home/me/apps/pi-web",
  maxToolsPreset: "coding" as const,
};

test("pi_chat_start validates cwd and starts a session", async () => {
  const client = new FakeClient();
  const tools = createChatTools({ client: client as never, baseUrl: "http://127.0.0.1:3030", safety, waitForAssistant: async () => ({ status: "completed", answer: "done" }) });
  const result = await tools.find((tool) => tool.name === "pi_chat_start")!.call({ cwd: "/home/me/apps/pi-web", message: "hi", toolsPreset: "readonly", waitSeconds: 1 });
  assert.equal(result.isError, undefined);
  assert.match(result.content[0].text, /"sessionId": "s1"/);
  assert.match(result.content[0].text, /"answer": "done"/);
});

test("pi_chat_abort sends abort command", async () => {
  const client = new FakeClient();
  const tools = createChatTools({ client: client as never, baseUrl: "http://127.0.0.1:3030", safety, waitForAssistant: async () => ({ status: "timeout" }) });
  await tools.find((tool) => tool.name === "pi_chat_abort")!.call({ sessionId: "s1" });
  assert.deepEqual(client.sent, [{ sessionId: "s1", command: { type: "abort" } }]);
});

test("northstar_ready_issues filters ready cards", async () => {
  const client = new FakeClient();
  const tools = createNorthstarReadTools({ client: client as never, safety });
  const result = await tools.find((tool) => tool.name === "northstar_ready_issues")!.call({ cwd: "/home/me/apps/pi-web" });
  assert.match(result.content[0].text, /Ready work/);
  assert.match(result.content[0].text, /"issueId": "15"/);
});

test("tools reject invalid arguments as tool errors", async () => {
  const client = new FakeClient();
  const tools = createChatTools({ client: client as never, baseUrl: "http://127.0.0.1:3030", safety, waitForAssistant: async () => ({ status: "timeout" }) });
  const result = await tools.find((tool) => tool.name === "pi_chat_start")!.call({ cwd: "/etc", message: "hi" });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /outside allowed roots/);
});
```

- [ ] **Step 2: Run the failing tool tests**

Run:

```bash
node --import tsx --test tests/xiaozhi-mcp/tools.test.ts
```

Expected: FAIL because the tool files do not exist.

- [ ] **Step 3: Implement `tools/chat.ts`**

Create `lib/xiaozhi-mcp/tools/chat.ts`:

```ts
import { jsonTextResult, errorTextResult, type XiaozhiMcpTool } from "../tool-registry";
import { mapToolsPreset, resolveAllowedPath, type ToolsPreset } from "../safety";
import type { AssistantWaitResult } from "../sse";
import type { PiWebClient } from "../pi-web-client";

interface ChatToolOptions {
  client: PiWebClient;
  baseUrl: string;
  safety: { allowedRoots: string[]; defaultCwd: string; maxToolsPreset: ToolsPreset };
  waitForAssistant(baseUrl: string, sessionId: string, timeoutMs: number): Promise<AssistantWaitResult>;
}

function obj(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function seconds(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(value, 300)) : fallback;
}

function handleError(error: unknown) {
  return errorTextResult(error instanceof Error ? error.message : String(error));
}

export function createChatTools(options: ChatToolOptions): XiaozhiMcpTool[] {
  return [
    {
      name: "pi_chat_start",
      description: "Start a new pi-web chat session in an allowed cwd and send the first message.",
      inputSchema: {
        type: "object",
        properties: {
          cwd: { type: "string" },
          message: { type: "string" },
          toolsPreset: { type: "string", enum: ["none", "readonly", "coding"] },
          thinkingLevel: { type: "string", enum: ["off", "low", "medium", "high", "xhigh"] },
          waitSeconds: { type: "number" },
        },
        required: ["message"],
      },
      async call(args) {
        try {
          const input = obj(args);
          const message = str(input.message);
          if (!message.trim()) throw new Error("message is required");
          const cwd = resolveAllowedPath(str(input.cwd, options.safety.defaultCwd), options.safety.allowedRoots);
          const toolNames = mapToolsPreset(input.toolsPreset, options.safety.maxToolsPreset);
          const created = await options.client.createChatSession({ cwd, message, toolNames, thinkingLevel: str(input.thinkingLevel) || undefined });
          const wait = await options.waitForAssistant(options.baseUrl, created.sessionId, seconds(input.waitSeconds, 60) * 1000);
          return jsonTextResult({
            sessionId: created.sessionId,
            cwd: created.cwd,
            status: wait.status,
            ...(wait.status === "completed" ? { answer: wait.answer } : {}),
            piWebUrl: `${options.baseUrl}?session=${encodeURIComponent(created.sessionId)}`,
          });
        } catch (error) {
          return handleError(error);
        }
      },
    },
    {
      name: "pi_chat_send",
      description: "Send a follow-up message to an existing pi-web chat session.",
      inputSchema: { type: "object", properties: { sessionId: { type: "string" }, message: { type: "string" }, waitSeconds: { type: "number" } }, required: ["sessionId", "message"] },
      async call(args) {
        try {
          const input = obj(args);
          const sessionId = str(input.sessionId);
          const message = str(input.message);
          if (!sessionId || !message.trim()) throw new Error("sessionId and message are required");
          await options.client.sendAgentCommand(sessionId, { type: "prompt", message });
          const wait = await options.waitForAssistant(options.baseUrl, sessionId, seconds(input.waitSeconds, 60) * 1000);
          return jsonTextResult({ sessionId, status: wait.status, ...(wait.status === "completed" ? { answer: wait.answer } : {}) });
        } catch (error) {
          return handleError(error);
        }
      },
    },
    {
      name: "pi_chat_state",
      description: "Read current pi-web agent state for a session.",
      inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
      async call(args) {
        try { return jsonTextResult(await options.client.getAgentState(str(obj(args).sessionId))); }
        catch (error) { return handleError(error); }
      },
    },
    {
      name: "pi_chat_read",
      description: "Read pi-web session history and context.",
      inputSchema: { type: "object", properties: { sessionId: { type: "string" }, limit: { type: "number" } }, required: ["sessionId"] },
      async call(args) {
        try { return jsonTextResult(await options.client.readSession(str(obj(args).sessionId))); }
        catch (error) { return handleError(error); }
      },
    },
    {
      name: "pi_chat_abort",
      description: "Abort a running pi-web chat session.",
      inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
      async call(args) {
        try {
          const sessionId = str(obj(args).sessionId);
          if (!sessionId) throw new Error("sessionId is required");
          await options.client.sendAgentCommand(sessionId, { type: "abort" });
          return jsonTextResult({ sessionId, aborted: true });
        } catch (error) {
          return handleError(error);
        }
      },
    },
    {
      name: "pi_sessions_list",
      description: "List pi-web sessions and optionally filter by allowed cwd.",
      inputSchema: { type: "object", properties: { cwd: { type: "string" }, limit: { type: "number" } } },
      async call(args) {
        try {
          const input = obj(args);
          const cwd = input.cwd ? resolveAllowedPath(str(input.cwd), options.safety.allowedRoots) : "";
          const limit = Math.max(1, Math.min(seconds(input.limit, 20), 100));
          const data = await options.client.listSessions();
          const sessions = typeof data === "object" && data && Array.isArray((data as { sessions?: unknown }).sessions) ? (data as { sessions: unknown[] }).sessions : [];
          const filtered = sessions.filter((session) => !cwd || (typeof session === "object" && session !== null && (session as { cwd?: unknown }).cwd === cwd)).slice(0, limit);
          return jsonTextResult({ sessions: filtered });
        } catch (error) {
          return handleError(error);
        }
      },
    },
  ];
}
```

- [ ] **Step 4: Implement `tools/northstar-read.ts`**

Create `lib/xiaozhi-mcp/tools/northstar-read.ts`:

```ts
import { configFromCwd, resolveAllowedPath, validateNorthstarConfig } from "../safety";
import { errorTextResult, jsonTextResult, type XiaozhiMcpTool } from "../tool-registry";
import type { PiWebClient } from "../pi-web-client";

interface NorthstarToolOptions {
  client: PiWebClient;
  safety: { allowedRoots: string[]; defaultCwd: string };
}

function obj(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function handleError(error: unknown) {
  return errorTextResult(error instanceof Error ? error.message : String(error));
}

function resolveConfig(input: Record<string, unknown>, options: NorthstarToolOptions): string {
  if (typeof input.config === "string" && input.config.trim()) return validateNorthstarConfig(input.config, options.safety.allowedRoots);
  const cwd = resolveAllowedPath(str(input.cwd, options.safety.defaultCwd), options.safety.allowedRoots);
  return configFromCwd(cwd, options.safety.allowedRoots);
}

function firstProjectId(projectsResult: unknown, explicitProjectId: unknown): string {
  if (typeof explicitProjectId === "string" && explicitProjectId) return explicitProjectId;
  const projects = typeof projectsResult === "object" && projectsResult && Array.isArray((projectsResult as { projects?: unknown }).projects)
    ? (projectsResult as { projects: Array<{ projectId?: unknown }> }).projects
    : [];
  const first = projects.find((project) => typeof project.projectId === "string");
  if (!first || typeof first.projectId !== "string") throw new Error("No Northstar project found");
  return first.projectId;
}

export function createNorthstarReadTools(options: NorthstarToolOptions): XiaozhiMcpTool[] {
  return [
    {
      name: "northstar_ready_issues",
      description: "List ready Northstar issue cards for an allowed cwd or config.",
      inputSchema: { type: "object", properties: { cwd: { type: "string" }, config: { type: "string" }, projectId: { type: "string" } } },
      async call(args) {
        try {
          const input = obj(args);
          const config = resolveConfig(input, options);
          const projects = await options.client.getNorthstarProjects(config);
          const projectId = firstProjectId(projects, input.projectId);
          const board = await options.client.getNorthstarBoard(projectId, config);
          const groups = typeof board === "object" && board && Array.isArray((board as { groups?: unknown }).groups) ? (board as { groups: Array<{ lifecycle?: unknown; cards?: unknown }> }).groups : [];
          const ready = groups.flatMap((group) => group.lifecycle === "ready" && Array.isArray(group.cards) ? group.cards : []);
          return jsonTextResult({ config, projectId, ready });
        } catch (error) {
          return handleError(error);
        }
      },
    },
    {
      name: "northstar_issue_detail",
      description: "Read one Northstar issue detail plus event history.",
      inputSchema: { type: "object", properties: { cwd: { type: "string" }, config: { type: "string" }, projectId: { type: "string" }, issueId: { type: "string" } }, required: ["projectId", "issueId"] },
      async call(args) {
        try {
          const input = obj(args);
          const config = resolveConfig(input, options);
          const projectId = str(input.projectId);
          const issueId = str(input.issueId);
          if (!projectId || !issueId) throw new Error("projectId and issueId are required");
          const issue = await options.client.getNorthstarIssue(projectId, issueId, config);
          const events = await options.client.getNorthstarIssueEvents(projectId, issueId, config);
          return jsonTextResult({ config, projectId, issueId, issue, events });
        } catch (error) {
          return handleError(error);
        }
      },
    },
    {
      name: "northstar_watch_status",
      description: "Read Northstar watch process status for an allowed cwd or config.",
      inputSchema: { type: "object", properties: { cwd: { type: "string" }, config: { type: "string" } } },
      async call(args) {
        try {
          const config = resolveConfig(obj(args), options);
          return jsonTextResult(await options.client.getNorthstarWatchStatus(config));
        } catch (error) {
          return handleError(error);
        }
      },
    },
  ];
}
```

- [ ] **Step 5: Run tool tests until they pass**

Run:

```bash
node --import tsx --test tests/xiaozhi-mcp/tools.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add lib/xiaozhi-mcp/tools/chat.ts lib/xiaozhi-mcp/tools/northstar-read.ts tests/xiaozhi-mcp/tools.test.ts
git commit -m "feat(xiaozhi-mcp): add chat and northstar tools"
```

---

### Task 6: WebSocket client, CLI assembly, and package bin

**Files:**
- Create: `tests/xiaozhi-mcp/websocket-client.test.ts`
- Create: `lib/xiaozhi-mcp/websocket-client.ts`
- Create: `lib/xiaozhi-mcp/cli.ts`
- Create: `bin/pi-web-xiaozhi-mcp.js`
- Modify: `package.json`

- [ ] **Step 1: Write failing WebSocket client tests**

Create `tests/xiaozhi-mcp/websocket-client.test.ts`:

```ts
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { test } from "node:test";
import WebSocket, { WebSocketServer } from "ws";

import { connectXiaozhiMcpOnce } from "../../lib/xiaozhi-mcp/websocket-client";
import { buildResult } from "../../lib/xiaozhi-mcp/json-rpc";

async function startWsServer(): Promise<{ url: string; wss: WebSocketServer; close(): Promise<void> }> {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unexpected address");
  return {
    url: `ws://127.0.0.1:${address.port}`,
    wss,
    close: () => new Promise((resolve) => wss.close(() => server.close(() => resolve()))),
  };
}

test("connectXiaozhiMcpOnce responds to raw JSON-RPC requests", async () => {
  const server = await startWsServer();
  try {
    const clientDone = connectXiaozhiMcpOnce({
      endpoint: server.url,
      handleRequest: async (request) => buildResult(request.id, { method: request.method }),
      log: () => {},
    });

    const [socket] = await once(server.wss, "connection") as [WebSocket];
    socket.send(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }));
    const [message] = await once(socket, "message") as [Buffer];
    assert.deepEqual(JSON.parse(message.toString()), { jsonrpc: "2.0", id: 1, result: { method: "ping" } });
    socket.close();
    await clientDone;
  } finally {
    await server.close();
  }
});

test("connectXiaozhiMcpOnce preserves wrapped MCP responses", async () => {
  const server = await startWsServer();
  try {
    const clientDone = connectXiaozhiMcpOnce({
      endpoint: server.url,
      handleRequest: async (request) => buildResult(request.id, { method: request.method }),
      log: () => {},
    });

    const [socket] = await once(server.wss, "connection") as [WebSocket];
    socket.send(JSON.stringify({ session_id: "s1", type: "mcp", payload: { jsonrpc: "2.0", id: 2, method: "tools/list" } }));
    const [message] = await once(socket, "message") as [Buffer];
    assert.deepEqual(JSON.parse(message.toString()), { session_id: "s1", type: "mcp", payload: { jsonrpc: "2.0", id: 2, result: { method: "tools/list" } } });
    socket.close();
    await clientDone;
  } finally {
    await server.close();
  }
});
```

- [ ] **Step 2: Run the failing WebSocket tests**

Run:

```bash
node --import tsx --test tests/xiaozhi-mcp/websocket-client.test.ts
```

Expected: FAIL because `websocket-client.ts` does not exist.

- [ ] **Step 3: Implement `websocket-client.ts`**

Create `lib/xiaozhi-mcp/websocket-client.ts`:

```ts
import WebSocket from "ws";

import { buildError, parseIncomingMessage, stringifyOutgoingMessage, unwrapIncomingMessage, wrapOutgoingMessage, type JsonRpcRequest, type JsonRpcResponse } from "./json-rpc";
import { redactSecrets } from "./safety";

export interface XiaozhiWebSocketOptions {
  endpoint: string;
  handleRequest(request: JsonRpcRequest): Promise<JsonRpcResponse | undefined>;
  log(message: string): void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function connectXiaozhiMcpOnce(options: XiaozhiWebSocketOptions): Promise<void> {
  const ws = new WebSocket(options.endpoint);

  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  options.log(`connected to ${redactSecrets(options.endpoint)}`);

  ws.on("message", (data) => {
    void (async () => {
      if (typeof data !== "string" && !Buffer.isBuffer(data)) return;
      const text = typeof data === "string" ? data : data.toString("utf8");
      let envelope;
      try {
        envelope = parseIncomingMessage(text);
      } catch {
        ws.send(stringifyOutgoingMessage(buildError(null, -32700, "Parse error")));
        return;
      }

      const incoming = unwrapIncomingMessage(envelope);
      if (!incoming.valid) {
        ws.send(stringifyOutgoingMessage(wrapOutgoingMessage(envelope, incoming.error)));
        return;
      }

      const response = await options.handleRequest(incoming.request);
      if (response) ws.send(stringifyOutgoingMessage(wrapOutgoingMessage(envelope, response)));
    })().catch((error) => {
      options.log(`request failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  });

  await new Promise<void>((resolve) => {
    ws.once("close", () => resolve());
  });
}

export async function connectXiaozhiMcpForever(options: XiaozhiWebSocketOptions): Promise<void> {
  let backoff = 1000;
  while (true) {
    try {
      await connectXiaozhiMcpOnce(options);
      backoff = 1000;
    } catch (error) {
      options.log(`connection failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    options.log(`reconnecting in ${Math.round(backoff / 1000)}s`);
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 600_000);
  }
}
```

- [ ] **Step 4: Implement `cli.ts`**

Create `lib/xiaozhi-mcp/cli.ts`:

```ts
import { PiWebClient } from "./pi-web-client";
import { waitForAssistantMessage } from "./sse";
import { assertLocalPiWebBaseUrl, parseAllowedRoots, parseMaxToolsPreset, redactSecrets, resolveAllowedPath } from "./safety";
import { createMcpHandler, createToolRegistry } from "./tool-registry";
import { createChatTools } from "./tools/chat";
import { createNorthstarReadTools } from "./tools/northstar-read";
import { connectXiaozhiMcpForever } from "./websocket-client";

export async function main(): Promise<void> {
  const endpoint = process.env.XIAOZHI_MCP_ENDPOINT;
  if (!endpoint) throw new Error("XIAOZHI_MCP_ENDPOINT is required");

  const baseUrl = assertLocalPiWebBaseUrl(process.env.PI_WEB_BASE_URL);
  const allowedRoots = parseAllowedRoots(process.env.PI_WEB_MCP_ALLOWED_ROOTS);
  if (allowedRoots.length === 0) throw new Error("PI_WEB_MCP_ALLOWED_ROOTS is required");
  const defaultCwd = resolveAllowedPath(process.env.PI_WEB_MCP_DEFAULT_CWD || allowedRoots[0], allowedRoots);
  const maxToolsPreset = parseMaxToolsPreset(process.env.PI_WEB_MCP_MAX_TOOLS_PRESET);

  const client = new PiWebClient(baseUrl);
  const registry = createToolRegistry();
  const safety = { allowedRoots, defaultCwd, maxToolsPreset };
  for (const tool of createChatTools({ client, baseUrl, safety, waitForAssistant: waitForAssistantMessage })) registry.register(tool);
  for (const tool of createNorthstarReadTools({ client, safety })) registry.register(tool);

  const handleRequest = createMcpHandler(registry);
  const log = (message: string) => console.error(`[pi-web-xiaozhi-mcp] ${redactSecrets(message)}`);
  log(`starting adapter endpoint=${redactSecrets(endpoint)} baseUrl=${baseUrl} defaultCwd=${defaultCwd}`);
  await connectXiaozhiMcpForever({ endpoint, handleRequest, log });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`[pi-web-xiaozhi-mcp] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Create the bin wrapper**

Create `bin/pi-web-xiaozhi-mcp.js`:

```js
#!/usr/bin/env node
"use strict";

const { spawn } = require("child_process");
const path = require("path");

const entry = path.join(__dirname, "..", "lib", "xiaozhi-mcp", "cli.ts");
const child = spawn(process.execPath, ["--import", "tsx", entry], {
  cwd: path.join(__dirname, ".."),
  stdio: "inherit",
  env: { ...process.env },
});

child.on("exit", (code) => process.exit(code ?? 0));
```

Then make it executable:

```bash
chmod +x bin/pi-web-xiaozhi-mcp.js
```

- [ ] **Step 6: Modify `package.json` bin and scripts**

Edit `package.json` so the `bin` object includes `pi-web-xiaozhi-mcp`, and `scripts` includes `test:xiaozhi-mcp`.

Expected edited fragments:

```json
"bin": {
  "pi-web": "bin/pi-web.js",
  "pi-voice-gateway": "bin/pi-voice-gateway.js",
  "pi-web-xiaozhi-mcp": "bin/pi-web-xiaozhi-mcp.js"
}
```

```json
"scripts": {
  "dev": "next dev -p 3030 --webpack",
  "build": "next build --webpack",
  "start": "next start -p 30141",
  "lint": "eslint .",
  "test:voice": "node --test tests/voice-gateway/*.test.mjs",
  "test:xiaozhi-mcp": "node --import tsx --test tests/xiaozhi-mcp/*.test.ts",
  "check": "node_modules/.bin/tsc --noEmit && npm run lint && npm run test:voice && npm run test:xiaozhi-mcp",
  "pack:suite": "node scripts/build-northstar-suite.mjs",
  "release": "npm version patch --no-git-tag-version && npm run build && npm publish --access public"
}
```

If existing scripts differ because of parallel user changes, preserve those user changes and add only the new `test:xiaozhi-mcp` script plus the `check` inclusion.

- [ ] **Step 7: Run WebSocket tests until they pass**

Run:

```bash
node --import tsx --test tests/xiaozhi-mcp/websocket-client.test.ts
```

Expected: PASS.

- [ ] **Step 8: Smoke-test CLI validation**

Run:

```bash
node bin/pi-web-xiaozhi-mcp.js
```

Expected: exits non-zero with message containing `XIAOZHI_MCP_ENDPOINT is required`.

Run:

```bash
XIAOZHI_MCP_ENDPOINT='wss://example/mcp/?token=secret' \
PI_WEB_MCP_ALLOWED_ROOTS='/home/timmypai/apps' \
PI_WEB_MCP_DEFAULT_CWD='/home/timmypai/apps/pi-web' \
node bin/pi-web-xiaozhi-mcp.js
```

Expected: attempts to connect, logs the endpoint with `token=REDACTED`, then retries. Stop it with Ctrl-C after seeing one retry message.

- [ ] **Step 9: Commit Task 6**

```bash
git add lib/xiaozhi-mcp/websocket-client.ts lib/xiaozhi-mcp/cli.ts bin/pi-web-xiaozhi-mcp.js tests/xiaozhi-mcp/websocket-client.test.ts package.json
git commit -m "feat(xiaozhi-mcp): add websocket adapter cli"
```

---

### Task 7: Documentation and full verification

**Files:**
- Create: `docs/xiaozhi-mcp.md`

- [ ] **Step 1: Write operator documentation**

Create `docs/xiaozhi-mcp.md`:

````md
# Xiaozhi MCP Adapter

`pi-web-xiaozhi-mcp` connects a local pi-web server to a Xiaozhi WebSocket MCP endpoint. It is implemented in TypeScript/Node.js and does not use Python.

## Start pi-web

```bash
cd /home/timmypai/apps/pi-web
npm run dev
```

The adapter expects pi-web at `http://127.0.0.1:3030` by default.

## Start the adapter

```bash
export XIAOZHI_MCP_ENDPOINT="wss://your-xiaozhi-host/mcp/?token=YOUR_TOKEN"
export PI_WEB_BASE_URL="http://127.0.0.1:3030"
export PI_WEB_MCP_ALLOWED_ROOTS="/home/timmypai/apps"
export PI_WEB_MCP_DEFAULT_CWD="/home/timmypai/apps/pi-web"
export PI_WEB_MCP_MAX_TOOLS_PRESET="readonly"
node bin/pi-web-xiaozhi-mcp.js
```

The adapter redacts `token=` values in logs.

## Exposed tools

- `pi_chat_start` — create a pi-web chat session and send the first message.
- `pi_chat_send` — continue an existing pi-web chat session.
- `pi_chat_state` — read live session state.
- `pi_chat_read` — read session history.
- `pi_chat_abort` — abort a running session.
- `pi_sessions_list` — list pi-web sessions.
- `northstar_ready_issues` — list ready Northstar cards.
- `northstar_issue_detail` — read issue detail and events.
- `northstar_watch_status` — read Northstar watch process state.

## Safety defaults

`PI_WEB_MCP_ALLOWED_ROOTS` is required. Every cwd and Northstar config path must resolve under one of those roots.

`PI_WEB_MCP_MAX_TOOLS_PRESET` defaults to `readonly`. Set it to `coding` only when Xiaozhi should be allowed to start pi sessions with edit/write/bash tools.

The adapter does not expose arbitrary shell execution and does not expose Northstar mutation actions in the MVP.

## Troubleshooting

### `XIAOZHI_MCP_ENDPOINT is required`

Set the endpoint environment variable before starting the adapter.

### `PI_WEB_MCP_ALLOWED_ROOTS is required`

Set at least one allowed root, for example:

```bash
export PI_WEB_MCP_ALLOWED_ROOTS="/home/timmypai/apps"
```

### pi-web unavailable

Start pi-web with `npm run dev` and verify this URL works:

```bash
curl http://127.0.0.1:3030/api/sessions
```

### cwd rejected

Use a cwd under `PI_WEB_MCP_ALLOWED_ROOTS`. For example, if the root is `/home/timmypai/apps`, `/home/timmypai/apps/pi-web` is allowed and `/etc` is rejected.
````

- [ ] **Step 2: Run all Xiaozhi MCP tests**

Run:

```bash
npm run test:xiaozhi-mcp
```

Expected: PASS for every test in `tests/xiaozhi-mcp`.

- [ ] **Step 3: Run TypeScript typecheck**

Run:

```bash
node_modules/.bin/tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS or only pre-existing unrelated warnings. If lint reports issues in files from this plan, fix those files and rerun `npm run lint`.

- [ ] **Step 5: Run existing voice tests if package check includes them**

Run:

```bash
npm run test:voice
```

Expected: PASS. If voice tests fail because of pre-existing unrelated workspace changes, capture the failure output and do not modify voice files unless the failure is caused by this plan.

- [ ] **Step 6: Run full check**

Run:

```bash
npm run check
```

Expected: PASS. Do not run `next build`.

- [ ] **Step 7: Commit Task 7**

```bash
git add docs/xiaozhi-mcp.md package.json package-lock.json
git commit -m "docs(xiaozhi-mcp): document adapter setup"
```

If `package-lock.json` is unchanged, omit it from `git add`.

---

## Completion audit

Before claiming completion, verify every explicit requirement:

- TypeScript/Node implementation exists: `bin/pi-web-xiaozhi-mcp.js` and `lib/xiaozhi-mcp/*.ts`.
- No Python dependency exists in adapter files.
- Adapter connects to WebSocket endpoint through `ws`.
- Raw JSON-RPC and wrapped Xiaozhi MCP messages are covered by tests.
- `tools/list` and `tools/call` work through registry tests.
- Chat/session tools exist and are covered by tests.
- Northstar read-only tools exist and are covered by tests.
- cwd allowlist, local base URL, tool preset limit, and token redaction are covered by tests.
- Docs explain setup, env vars, tools, and troubleshooting.
- `npm run test:xiaozhi-mcp` passes.
- `node_modules/.bin/tsc --noEmit` passes.
- `npm run lint` passes or reports only documented unrelated pre-existing issues.
- `npm run check` passes or any unrelated pre-existing failure is documented with command output.

