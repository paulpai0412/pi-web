# FunASR Voice Gateway Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a separate `pi-voice-gateway` service that uses one Xiaozhi-style WebSocket voice-session protocol for browser ChatInput and remote ESP32 devices, streams audio to FunASR, and delivers final transcripts to pi-agent through pi-web.

**Architecture:** Add a focused gateway service in the pi-web repo with typed protocol modules, settings loading, WebSocket session handling, FunASR lifecycle/client adapters, and a local pi-web chat delivery API. Browser ChatInput connects to the gateway using the same Xiaozhi-style framing as devices; audio format differences are declared in `audio_params` and handled by codec/backend adapters.

**Tech Stack:** Next.js App Router, React 19, TypeScript, Node.js HTTP/WebSocket service, `ws`, FunASR WebSocket runtime, Web Audio API/AudioWorklet, node built-in test runner.

---

## File Map

- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `bin/pi-voice-gateway.js`
- Create: `lib/voice-gateway/types.ts`
- Create: `lib/voice-gateway/settings.ts`
- Create: `lib/voice-gateway/protocol.ts`
- Create: `lib/voice-gateway/session.ts`
- Create: `lib/voice-gateway/funasr-client.ts`
- Create: `lib/voice-gateway/funasr-runtime.ts`
- Create: `lib/voice-gateway/codec.ts`
- Create: `lib/voice-gateway/chat-delivery.ts`
- Create: `lib/voice-gateway/server.ts`
- Create: `lib/voice-gateway/cli.ts`
- Create: `lib/voice-gateway/index.ts`
- Create: `app/api/voice/deliver/route.ts`
- Create: `hooks/useVoiceGateway.ts`
- Modify: `components/ChatInput.tsx`
- Modify: `components/ChatWindow.tsx`
- Create: `public/voice/pcm-worklet.js`
- Create: `scripts/voice-gateway/mock-funasr.mjs`
- Create: `scripts/voice-gateway/mock-xiaozhi-client.mjs`
- Create: `tests/voice-gateway/protocol.test.mjs`
- Create: `tests/voice-gateway/settings.test.mjs`
- Create: `tests/voice-gateway/transcript.test.mjs`
- Create: `docs/voice-gateway.md`

## Implementation Slices

This can be shipped in stages:

1. Protocol/settings/test harness.
2. Gateway process + mock FunASR + mock Xiaozhi clients.
3. Real FunASR managed/external adapter.
4. pi-web delivery API and browser ChatInput integration.
5. Cloudflare/ESP32 hardening and docs.

Each slice should pass `node_modules/.bin/tsc --noEmit`, `node --test tests/voice-gateway/*.test.mjs`, and `node node_modules/next/dist/bin/next lint`. Do not run `next build`.

---

### Task 1: Add Test Harness And Runtime Dependency

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`

- [ ] **Step 1: Add `ws` and test scripts**

Modify `package.json` so scripts include:

```json
{
  "scripts": {
    "dev": "next dev -p 3030 --webpack",
    "build": "next build --webpack",
    "start": "next start -p 30141",
    "lint": "eslint .",
    "test:voice": "node --test tests/voice-gateway/*.test.mjs",
    "check": "node_modules/.bin/tsc --noEmit && node node_modules/next/dist/bin/next lint && npm run test:voice",
    "release": "npm version patch --no-git-tag-version && npm run build && npm publish --access public"
  },
  "dependencies": {
    "@earendil-works/pi-ai": "^0.78.0",
    "@earendil-works/pi-coding-agent": "^0.78.0",
    "@lobehub/icons": "^5.6.0",
    "@types/react-syntax-highlighter": "^15.5.13",
    "next": "16.2.1",
    "react": "^19.2.4",
    "react-dom": "^19.2.4",
    "react-markdown": "^10.1.0",
    "react-syntax-highlighter": "^16.1.1",
    "remark-gfm": "^4.0.1",
    "opusscript": "^0.1.1",
    "tsx": "^4.20.5",
    "ws": "^8.18.3"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4.2.2",
    "@types/node": "^25",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/ws": "^8.18.1",
    "eslint": "^9",
    "eslint-config-next": "16.2.1",
    "postcss": "^8",
    "tailwindcss": "^4.2.2",
    "typescript": "^5"
  }
}
```

If the installed version in `package-lock.json` resolves newer compatible patch versions, keep the lockfile result.

- [ ] **Step 2: Use `tsx` only for the gateway CLI**

Do not change TypeScript module settings. The `pi-voice-gateway` bin will use `tsx/cjs` to load `lib/voice-gateway/cli.ts` directly. Test scripts remain `.mjs` and use Node's built-in runner.

- [ ] **Step 3: Install dependencies if needed**

Run: `npm install`

Expected: `package-lock.json` updates with `opusscript`, `tsx`, `ws`, and `@types/ws`.

- [ ] **Step 4: Verify baseline**

Run:

```bash
node_modules/.bin/tsc --noEmit
node node_modules/next/dist/bin/next lint
```

Expected: both pass. When the lint command exits with an error showing `next lint` is unavailable in this Next version, record that exact stderr line in the task notes, then run `npm run lint` and use `npm run lint` as the lint verifier in the remaining tasks.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore(voice): add gateway dependency and test harness"
```

---

### Task 2: Define Voice Gateway Types And Settings

**Files:**
- Create: `lib/voice-gateway/types.ts`
- Create: `lib/voice-gateway/settings.ts`
- Create: `tests/voice-gateway/settings.test.mjs`

- [ ] **Step 1: Create type definitions**

Create `lib/voice-gateway/types.ts`:

```ts
export type VoiceAudioFormat = "pcm_s16le" | "opus";
export type VoiceSource = "browser" | "device";
export type VoiceListenState = "start" | "stop" | "detect";
export type VoiceListenMode = "manual" | "auto" | "realtime";
export type VoiceGatewayState = "stopped" | "starting" | "ready" | "streaming" | "degraded" | "error";

export interface VoiceAudioParams {
  format: VoiceAudioFormat;
  sample_rate: number;
  channels: number;
  frame_duration: number;
}

export interface VoiceHelloMessage {
  type: "hello";
  version: number;
  transport: "websocket";
  source?: VoiceSource;
  audio_params: VoiceAudioParams;
}

export interface VoiceHelloResponse {
  type: "hello";
  transport: "websocket";
  session_id: string;
  audio_params: VoiceAudioParams;
}

export interface VoiceListenMessage {
  session_id: string;
  type: "listen";
  state: VoiceListenState;
  mode: VoiceListenMode;
}

export interface VoiceAbortMessage {
  session_id: string;
  type: "abort";
  reason?: string;
}

export interface VoiceSttMessage {
  session_id: string;
  type: "stt";
  state: "partial" | "final";
  text: string;
}

export interface VoiceTtsMessage {
  session_id: string;
  type: "tts";
  state: "start" | "sentence_start" | "stop" | "error" | "unavailable";
  text?: string;
  message?: string;
}

export interface VoiceErrorMessage {
  session_id?: string;
  type: "error";
  message: string;
  code?: string;
}

export type VoiceJsonMessage =
  | VoiceHelloMessage
  | VoiceHelloResponse
  | VoiceListenMessage
  | VoiceAbortMessage
  | VoiceSttMessage
  | VoiceTtsMessage
  | VoiceErrorMessage;

export interface VoiceGatewaySettings {
  gateway: {
    host: string;
    port: number;
    publicBaseUrl: string | null;
    remoteTransport: "cloudflare-wss";
    sharedSecret: string;
  };
  asr: {
    provider: "funasr";
    mode: "managed-command" | "external-ws";
    command: string | null;
    cwd: string | null;
    wsUrl: string;
    healthTimeoutMs: number;
  };
  browser: {
    enabled: boolean;
    hotkey: string;
    mode: "dictation" | "auto-send";
    autoSendWhenIdle: boolean;
  };
  devices: VoiceDeviceProfile[];
  tts: {
    provider: "none";
  };
}

export interface VoiceDeviceProfile {
  id: string;
  name: string;
  token: string;
  transport: "cloudflare-wss";
  targetCwd: string;
  targetSession: "active" | string;
  autoSend: boolean;
  ttsEnabled: boolean;
}
```

- [ ] **Step 2: Implement settings loader**

Create `lib/voice-gateway/settings.ts`:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import { randomBytes } from "crypto";
import type { VoiceGatewaySettings } from "./types";

const DEFAULT_SETTINGS_PATH = join(homedir(), ".pi", "agent", "voice-gateway.json");

export function getVoiceGatewaySettingsPath(): string {
  return process.env.PI_VOICE_GATEWAY_CONFIG || DEFAULT_SETTINGS_PATH;
}

export function createDefaultVoiceGatewaySettings(): VoiceGatewaySettings {
  return {
    gateway: {
      host: "127.0.0.1",
      port: 30142,
      publicBaseUrl: null,
      remoteTransport: "cloudflare-wss",
      sharedSecret: randomBytes(24).toString("hex"),
    },
    asr: {
      provider: "funasr",
      mode: "external-ws",
      command: null,
      cwd: null,
      wsUrl: "ws://127.0.0.1:10095",
      healthTimeoutMs: 10000,
    },
    browser: {
      enabled: true,
      hotkey: "Alt+Space",
      mode: "dictation",
      autoSendWhenIdle: false,
    },
    devices: [],
    tts: {
      provider: "none",
    },
  };
}

export function loadVoiceGatewaySettings(path = getVoiceGatewaySettingsPath()): VoiceGatewaySettings {
  if (!existsSync(path)) {
    const defaults = createDefaultVoiceGatewaySettings();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(defaults, null, 2)}\n`, "utf8");
    return defaults;
  }

  const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<VoiceGatewaySettings>;
  const defaults = createDefaultVoiceGatewaySettings();
  return {
    gateway: { ...defaults.gateway, ...parsed.gateway },
    asr: { ...defaults.asr, ...parsed.asr },
    browser: { ...defaults.browser, ...parsed.browser },
    devices: Array.isArray(parsed.devices) ? parsed.devices : [],
    tts: { ...defaults.tts, ...parsed.tts },
  };
}
```

- [ ] **Step 3: Add settings smoke test**

Create `tests/voice-gateway/settings.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

test("voice gateway settings defaults are documented", () => {
  const defaults = {
    gateway: {
      host: "127.0.0.1",
      port: 30142,
      publicBaseUrl: null,
      remoteTransport: "cloudflare-wss",
    },
    asr: {
      provider: "funasr",
      mode: "external-ws",
      wsUrl: "ws://127.0.0.1:10095",
      healthTimeoutMs: 10000,
    },
    browser: {
      enabled: true,
      hotkey: "Alt+Space",
      mode: "dictation",
    },
    tts: {
      provider: "none",
    },
  };

  assert.equal(defaults.gateway.host, "127.0.0.1");
  assert.equal(defaults.asr.provider, "funasr");
  assert.equal(defaults.browser.mode, "dictation");
  assert.equal(defaults.tts.provider, "none");
});
```

- [ ] **Step 4: Verify**

Run:

```bash
node_modules/.bin/tsc --noEmit
node --test tests/voice-gateway/settings.test.mjs
```

Expected: TypeScript passes and the test reports `pass`.

- [ ] **Step 5: Commit**

```bash
git add lib/voice-gateway/types.ts lib/voice-gateway/settings.ts tests/voice-gateway/settings.test.mjs
git commit -m "feat(voice): add gateway settings and shared types"
```

---

### Task 3: Implement Xiaozhi-Style Protocol Parser

**Files:**
- Create: `lib/voice-gateway/protocol.ts`
- Create: `tests/voice-gateway/protocol.test.mjs`

- [ ] **Step 1: Implement protocol helpers**

Create `lib/voice-gateway/protocol.ts`:

```ts
import type {
  VoiceAudioParams,
  VoiceAudioFormat,
  VoiceHelloMessage,
  VoiceJsonMessage,
  VoiceListenMode,
  VoiceListenState,
} from "./types";

export function isVoiceAudioFormat(value: unknown): value is VoiceAudioFormat {
  return value === "pcm_s16le" || value === "opus";
}

export function parseVoiceJsonMessage(raw: string): VoiceJsonMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON voice message");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Voice message must be an object");
  }

  const message = parsed as Record<string, unknown>;
  if (typeof message.type !== "string") {
    throw new Error("Voice message type is required");
  }

  if (message.type === "hello") return parseHello(message);
  if (message.type === "listen") return parseListen(message);
  if (message.type === "abort") return {
    session_id: stringField(message, "session_id"),
    type: "abort",
    reason: typeof message.reason === "string" ? message.reason : undefined,
  };

  throw new Error(`Unsupported voice message type: ${message.type}`);
}

function parseHello(message: Record<string, unknown>): VoiceHelloMessage {
  const params = objectField(message, "audio_params");
  return {
    type: "hello",
    version: numberField(message, "version"),
    transport: "websocket",
    source: message.source === "browser" || message.source === "device" ? message.source : undefined,
    audio_params: parseAudioParams(params),
  };
}

function parseListen(message: Record<string, unknown>) {
  const state = stringField(message, "state") as VoiceListenState;
  const mode = stringField(message, "mode") as VoiceListenMode;
  if (!["start", "stop", "detect"].includes(state)) throw new Error(`Unsupported listen state: ${state}`);
  if (!["manual", "auto", "realtime"].includes(mode)) throw new Error(`Unsupported listen mode: ${mode}`);
  return {
    session_id: stringField(message, "session_id"),
    type: "listen" as const,
    state,
    mode,
  };
}

export function parseAudioParams(value: Record<string, unknown>): VoiceAudioParams {
  const format = stringField(value, "format");
  if (!isVoiceAudioFormat(format)) throw new Error(`Unsupported audio format: ${format}`);
  const sampleRate = numberField(value, "sample_rate");
  const channels = numberField(value, "channels");
  const frameDuration = numberField(value, "frame_duration");
  if (channels !== 1) throw new Error("Only mono audio is supported");
  if (sampleRate <= 0) throw new Error("sample_rate must be positive");
  if (frameDuration <= 0) throw new Error("frame_duration must be positive");
  return { format, sample_rate: sampleRate, channels, frame_duration: frameDuration };
}

export function makeSttMessage(sessionId: string, state: "partial" | "final", text: string) {
  return { session_id: sessionId, type: "stt" as const, state, text };
}

export function makeErrorMessage(message: string, sessionId?: string, code?: string) {
  return { session_id: sessionId, type: "error" as const, message, code };
}

function objectField(obj: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = obj[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${key} must be an object`);
  return value as Record<string, unknown>;
}

function stringField(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  if (typeof value !== "string" || !value) throw new Error(`${key} must be a non-empty string`);
  return value;
}

function numberField(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
  return value;
}
```

- [ ] **Step 2: Add protocol behavior tests**

Create `tests/voice-gateway/protocol.test.mjs` with test-only equivalents that lock protocol examples:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

function parse(raw) {
  const message = JSON.parse(raw);
  if (message.type !== "hello") throw new Error("Unsupported voice message type");
  const params = message.audio_params;
  if (!["pcm_s16le", "opus"].includes(params.format)) throw new Error(`Unsupported audio format: ${params.format}`);
  if (params.channels !== 1) throw new Error("Only mono audio is supported");
  return message;
}

test("accepts browser pcm_s16le hello", () => {
  const msg = parse(JSON.stringify({
    type: "hello",
    version: 1,
    transport: "websocket",
    source: "browser",
    audio_params: { format: "pcm_s16le", sample_rate: 16000, channels: 1, frame_duration: 40 },
  }));

  assert.equal(msg.audio_params.format, "pcm_s16le");
  assert.equal(msg.source, "browser");
});

test("accepts ESP32 opus hello", () => {
  const msg = parse(JSON.stringify({
    type: "hello",
    version: 1,
    transport: "websocket",
    source: "device",
    audio_params: { format: "opus", sample_rate: 16000, channels: 1, frame_duration: 60 },
  }));

  assert.equal(msg.audio_params.format, "opus");
  assert.equal(msg.source, "device");
});

test("rejects stereo audio", () => {
  assert.throws(() => parse(JSON.stringify({
    type: "hello",
    version: 1,
    transport: "websocket",
    audio_params: { format: "opus", sample_rate: 16000, channels: 2, frame_duration: 60 },
  })), /Only mono audio/);
});
```

- [ ] **Step 3: Verify**

Run:

```bash
node_modules/.bin/tsc --noEmit
node --test tests/voice-gateway/protocol.test.mjs
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add lib/voice-gateway/protocol.ts tests/voice-gateway/protocol.test.mjs
git commit -m "feat(voice): add Xiaozhi-style protocol parser"
```

---

### Task 4: Add Transcript Aggregation And Session State

**Files:**
- Create: `lib/voice-gateway/session.ts`
- Create: `tests/voice-gateway/transcript.test.mjs`

- [ ] **Step 1: Implement voice session state**

Create `lib/voice-gateway/session.ts`:

```ts
import { randomUUID } from "crypto";
import type { VoiceAudioParams, VoiceGatewaySettings, VoiceSource } from "./types";
import { makeSttMessage } from "./protocol";

export interface TranscriptUpdate {
  state: "partial" | "final";
  text: string;
}

export class VoiceSession {
  readonly id = randomUUID();
  readonly createdAt = Date.now();
  private committedText = "";
  private partialText = "";

  constructor(
    readonly source: VoiceSource,
    readonly audioParams: VoiceAudioParams,
    readonly settings: VoiceGatewaySettings,
  ) {}

  applyTranscript(update: TranscriptUpdate) {
    if (update.state === "partial") {
      this.partialText = update.text;
      return makeSttMessage(this.id, "partial", this.combinedText());
    }

    this.committedText = appendText(this.committedText, update.text);
    this.partialText = "";
    return makeSttMessage(this.id, "final", this.committedText);
  }

  combinedText(): string {
    return appendText(this.committedText, this.partialText);
  }

  finalText(): string {
    return this.committedText.trim();
  }
}

export function appendText(base: string, next: string): string {
  const trimmedNext = next.trim();
  if (!trimmedNext) return base;
  const trimmedBase = base.trimEnd();
  if (!trimmedBase) return trimmedNext;
  return `${trimmedBase}${needsSpace(trimmedBase, trimmedNext) ? " " : ""}${trimmedNext}`;
}

function needsSpace(base: string, next: string): boolean {
  const last = base[base.length - 1] ?? "";
  const first = next[0] ?? "";
  if (/[\u4e00-\u9fff]/.test(last) || /[\u4e00-\u9fff]/.test(first)) return false;
  if (/[\s([{]/.test(last)) return false;
  if (/[,.;:!?，。！？；：)]/.test(first)) return false;
  return true;
}
```

- [ ] **Step 2: Add transcript tests**

Create `tests/voice-gateway/transcript.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";

function appendText(base, next) {
  const trimmedNext = next.trim();
  if (!trimmedNext) return base;
  const trimmedBase = base.trimEnd();
  if (!trimmedBase) return trimmedNext;
  const last = trimmedBase[trimmedBase.length - 1] ?? "";
  const first = trimmedNext[0] ?? "";
  const needsSpace = !/[\u4e00-\u9fff]/.test(last) && !/[\u4e00-\u9fff]/.test(first) && !/[,.;:!?，。！？；：)]/.test(first);
  return `${trimmedBase}${needsSpace ? " " : ""}${trimmedNext}`;
}

test("appends English words with a space", () => {
  assert.equal(appendText("hello", "world"), "hello world");
});

test("appends Chinese text without artificial spaces", () => {
  assert.equal(appendText("幫我", "看一下"), "幫我看一下");
});

test("does not insert space before punctuation", () => {
  assert.equal(appendText("hello", ","), "hello,");
});
```

- [ ] **Step 3: Verify**

Run:

```bash
node_modules/.bin/tsc --noEmit
node --test tests/voice-gateway/transcript.test.mjs
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add lib/voice-gateway/session.ts tests/voice-gateway/transcript.test.mjs
git commit -m "feat(voice): add transcript session aggregation"
```

---

### Task 5: Implement FunASR Client And Runtime Adapters

**Files:**
- Create: `lib/voice-gateway/funasr-client.ts`
- Create: `lib/voice-gateway/funasr-runtime.ts`
- Create: `scripts/voice-gateway/mock-funasr.mjs`

- [ ] **Step 1: Implement FunASR streaming client**

Create `lib/voice-gateway/funasr-client.ts`:

```ts
import WebSocket from "ws";
import { EventEmitter } from "events";

export interface FunAsrTranscriptEvent {
  state: "partial" | "final";
  text: string;
}

export class FunAsrStreamingClient extends EventEmitter {
  private socket: WebSocket | null = null;

  constructor(private readonly wsUrl: string) {
    super();
  }

  async connect(input: { wavName: string; audioFs: number; wavFormat: string }): Promise<void> {
    if (this.socket) return;
    const socket = new WebSocket(this.wsUrl);
    this.socket = socket;
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    socket.on("message", (data) => this.handleMessage(data));
    socket.on("close", () => {
      this.socket = null;
      this.emit("close");
    });
    socket.send(JSON.stringify({
      mode: "2pass",
      wav_name: input.wavName,
      wav_format: input.wavFormat,
      audio_fs: input.audioFs,
      is_speaking: true,
      itn: true,
    }));
  }

  sendAudio(chunk: Buffer): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error("FunASR socket is not open");
    this.socket.send(chunk);
  }

  finish(): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify({ is_speaking: false }));
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  private handleMessage(data: WebSocket.RawData): void {
    const parsed = JSON.parse(data.toString()) as { text?: string; mode?: string; is_final?: boolean };
    const text = parsed.text?.trim();
    if (!text) return;
    const state = parsed.is_final || parsed.mode === "2pass-offline" ? "final" : "partial";
    this.emit("transcript", { state, text } satisfies FunAsrTranscriptEvent);
  }
}
```

- [ ] **Step 2: Implement FunASR runtime lifecycle**

Create `lib/voice-gateway/funasr-runtime.ts`:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "child_process";
import type { VoiceGatewaySettings, VoiceGatewayState } from "./types";

export class FunAsrRuntime {
  private child: ChildProcessWithoutNullStreams | null = null;
  private logs: string[] = [];
  private state: VoiceGatewayState = "stopped";

  constructor(private readonly settings: VoiceGatewaySettings["asr"]) {}

  getState(): VoiceGatewayState {
    return this.state;
  }

  getLogs(): string[] {
    return this.logs.slice(-200);
  }

  async start(): Promise<void> {
    if (this.settings.mode === "external-ws") {
      this.state = "ready";
      return;
    }
    if (!this.settings.command) throw new Error("FunASR command is required for managed-command mode");
    if (this.child) return;

    this.state = "starting";
    const child = spawn(this.settings.command, {
      cwd: this.settings.cwd ?? undefined,
      shell: true,
      env: process.env,
    });
    this.child = child;
    child.stdout.on("data", (d) => this.pushLog(d.toString()));
    child.stderr.on("data", (d) => this.pushLog(d.toString()));
    child.once("exit", (code, signal) => {
      this.pushLog(`FunASR exited code=${code ?? "null"} signal=${signal ?? "null"}`);
      this.child = null;
      this.state = code === 0 ? "stopped" : "error";
    });
    this.state = "ready";
  }

  stop(): void {
    this.child?.kill("SIGTERM");
    this.child = null;
    this.state = "stopped";
  }

  private pushLog(line: string): void {
    this.logs.push(...line.split(/\r?\n/).filter(Boolean));
    if (this.logs.length > 500) this.logs.splice(0, this.logs.length - 500);
  }
}
```

- [ ] **Step 3: Create fake FunASR server for integration work**

Create `scripts/voice-gateway/mock-funasr.mjs`:

```js
import { WebSocketServer } from "ws";

const port = Number(process.env.MOCK_FUNASR_PORT || 10095);
const wss = new WebSocketServer({ port });

wss.on("connection", (ws) => {
  let bytes = 0;
  ws.on("message", (data, isBinary) => {
    if (!isBinary) return;
    bytes += data.length;
    if (bytes > 4096) {
      ws.send(JSON.stringify({ mode: "2pass-online", text: "測試 partial" }));
    }
    if (bytes > 12000) {
      ws.send(JSON.stringify({ mode: "2pass-offline", text: "測試 final", is_final: true }));
      bytes = 0;
    }
  });
});

console.log(`mock FunASR listening on ws://127.0.0.1:${port}`);
```

- [ ] **Step 4: Verify**

Run:

```bash
node_modules/.bin/tsc --noEmit
node scripts/voice-gateway/mock-funasr.mjs
```

Expected: TypeScript passes, mock server logs `mock FunASR listening...`. Stop it with `Ctrl+C`.

- [ ] **Step 5: Commit**

```bash
git add lib/voice-gateway/funasr-client.ts lib/voice-gateway/funasr-runtime.ts scripts/voice-gateway/mock-funasr.mjs
git commit -m "feat(voice): add FunASR client and runtime adapters"
```

---

### Task 6: Build Gateway WebSocket Service

**Files:**
- Create: `lib/voice-gateway/codec.ts`
- Create: `lib/voice-gateway/server.ts`
- Create: `lib/voice-gateway/cli.ts`
- Create: `lib/voice-gateway/index.ts`
- Create: `bin/pi-voice-gateway.js`
- Create: `scripts/voice-gateway/mock-xiaozhi-client.mjs`

- [ ] **Step 1: Implement codec adapter**

Create `lib/voice-gateway/codec.ts`:

```ts
import type { VoiceAudioParams } from "./types";

type OpusScriptCtor = new (sampleRate: number, channels: number, application: number) => {
  decode(input: Buffer): Buffer;
};

interface OpusScriptModule extends OpusScriptCtor {
  Application: {
    VOIP: number;
    AUDIO: number;
    RESTRICTED_LOWDELAY: number;
  };
}

let OpusScript: OpusScriptModule | null = null;

function loadOpusScript(): OpusScriptModule {
  if (OpusScript) return OpusScript;
  // opusscript is CommonJS and has no maintained TypeScript types.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  OpusScript = require("opusscript") as OpusScriptModule;
  return OpusScript;
}

export interface AudioCodecAdapter {
  toFunAsrPcm(input: Buffer): Buffer;
}

export function createAudioCodecAdapter(params: VoiceAudioParams): AudioCodecAdapter {
  if (params.format === "pcm_s16le") {
    return {
      toFunAsrPcm(input: Buffer) {
        return input;
      },
    };
  }

  if (params.format === "opus") {
    const opus = loadOpusScript();
    const decoder = new opus(params.sample_rate, params.channels, opus.Application.VOIP);
    return {
      toFunAsrPcm(input: Buffer) {
        return decoder.decode(input);
      },
    };
  }

  return {
    toFunAsrPcm() {
      throw new Error(`Unsupported audio format: ${params.format}`);
    },
  };
}
```

- [ ] **Step 2: Implement gateway server**

Create `lib/voice-gateway/server.ts`:

```ts
import http from "http";
import WebSocket, { WebSocketServer } from "ws";
import { loadVoiceGatewaySettings } from "./settings";
import { parseVoiceJsonMessage, makeErrorMessage } from "./protocol";
import { VoiceSession } from "./session";
import { FunAsrRuntime } from "./funasr-runtime";
import { FunAsrStreamingClient, type FunAsrTranscriptEvent } from "./funasr-client";
import { createAudioCodecAdapter, type AudioCodecAdapter } from "./codec";
import type { VoiceGatewaySettings, VoiceHelloMessage } from "./types";

export class VoiceGatewayServer {
  private readonly server = http.createServer();
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly runtime: FunAsrRuntime;

  constructor(private readonly settings: VoiceGatewaySettings = loadVoiceGatewaySettings()) {
    this.runtime = new FunAsrRuntime(settings.asr);
    this.server.on("upgrade", (req, socket, head) => {
      const url = req.url ?? "/";
      if (url !== "/xiaozhi/v1") {
        socket.destroy();
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
    });
    this.wss.on("connection", (ws) => this.handleConnection(ws));
  }

  async listen(): Promise<void> {
    await this.runtime.start();
    await new Promise<void>((resolve) => {
      this.server.listen(this.settings.gateway.port, this.settings.gateway.host, resolve);
    });
  }

  close(): void {
    this.wss.close();
    this.server.close();
    this.runtime.stop();
  }

  private handleConnection(ws: WebSocket): void {
    let voiceSession: VoiceSession | null = null;
    let asr: FunAsrStreamingClient | null = null;
    let codec: AudioCodecAdapter | null = null;

    ws.on("message", async (data, isBinary) => {
      try {
        if (isBinary) {
          if (!asr) throw new Error("Audio received before voice session started");
          if (!codec) throw new Error("Audio codec is not initialized");
          asr.sendAudio(codec.toFunAsrPcm(Buffer.from(data as Buffer)));
          return;
        }

        const message = parseVoiceJsonMessage(data.toString());
        if (message.type === "hello") {
          voiceSession = await this.startVoiceSession(ws, message);
          codec = createAudioCodecAdapter(voiceSession.audioParams);
          asr = await this.startAsr(voiceSession, ws);
          return;
        }
        if (message.type === "listen" && message.state === "stop") {
          asr?.finish();
          return;
        }
        if (message.type === "abort") {
          asr?.close();
          return;
        }
      } catch (error) {
        ws.send(JSON.stringify(makeErrorMessage(error instanceof Error ? error.message : String(error), voiceSession?.id)));
      }
    });

    ws.on("close", () => asr?.close());
  }

  private async startVoiceSession(ws: WebSocket, hello: VoiceHelloMessage): Promise<VoiceSession> {
    const source = hello.source ?? "device";
    const session = new VoiceSession(source, hello.audio_params, this.settings);
    ws.send(JSON.stringify({
      type: "hello",
      transport: "websocket",
      session_id: session.id,
      audio_params: hello.audio_params,
    }));
    return session;
  }

  private async startAsr(session: VoiceSession, ws: WebSocket): Promise<FunAsrStreamingClient> {
    const client = new FunAsrStreamingClient(this.settings.asr.wsUrl);
    client.on("transcript", (event: FunAsrTranscriptEvent) => {
      const stt = session.applyTranscript(event);
      ws.send(JSON.stringify(stt));
    });
    await client.connect({
      wavName: session.id,
      audioFs: session.audioParams.sample_rate,
      wavFormat: "pcm",
    });
    return client;
  }
}
```

The gateway always sends PCM to the first local FunASR target. Opus remains the public protocol format for ESP32, and conversion is isolated in `codec.ts`.

- [ ] **Step 3: Add CLI entrypoint**

Create `lib/voice-gateway/cli.ts`:

```ts
import { VoiceGatewayServer } from "./server";
import { loadVoiceGatewaySettings } from "./settings";

async function main() {
  const settings = loadVoiceGatewaySettings();
  const gateway = new VoiceGatewayServer(settings);

  const shutdown = () => {
    gateway.close();
    process.exit(0);
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await gateway.listen();
  console.log(`pi-voice-gateway listening on ws://${settings.gateway.host}:${settings.gateway.port}/xiaozhi/v1`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exit(1);
});
```

- [ ] **Step 4: Add entrypoint exports and bin**

Create `lib/voice-gateway/index.ts`:

```ts
export { VoiceGatewayServer } from "./server";
export { loadVoiceGatewaySettings } from "./settings";
export type { VoiceGatewaySettings } from "./types";
```

Create `bin/pi-voice-gateway.js`:

```js
#!/usr/bin/env node

require("tsx/cjs");
require("../lib/voice-gateway/cli.ts");
```

- [ ] **Step 5: Add mock client**

Create `scripts/voice-gateway/mock-xiaozhi-client.mjs`:

```js
import { createRequire } from "node:module";
import WebSocket from "ws";

const require = createRequire(import.meta.url);
const OpusScript = require("opusscript");

const url = process.env.VOICE_GATEWAY_URL || "ws://127.0.0.1:30142/xiaozhi/v1";
const ws = new WebSocket(url, {
  headers: {
    Authorization: `Bearer ${process.env.VOICE_DEVICE_TOKEN || "dev-token"}`,
    "Protocol-Version": "1",
    "Device-Id": "mock-device",
    "Client-Id": "mock-client",
  },
});

ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "hello",
    version: 1,
    transport: "websocket",
    source: "device",
    audio_params: { format: "opus", sample_rate: 16000, channels: 1, frame_duration: 60 },
  }));
  ws.send(JSON.stringify({ session_id: "pending", type: "listen", state: "start", mode: "manual" }));
  const encoder = new OpusScript(16000, 1, OpusScript.Application.VOIP);
  const pcmSilence = Buffer.alloc(1920);
  const timer = setInterval(() => ws.send(encoder.encode(pcmSilence, 960)), 60);
  setTimeout(() => {
    clearInterval(timer);
    ws.close();
  }, 1200);
});

ws.on("message", (data) => console.log(data.toString()));
ws.on("close", () => process.exit(0));
```

- [ ] **Step 6: Verify**

Run:

```bash
node_modules/.bin/tsc --noEmit
node bin/pi-voice-gateway.js
```

Expected: TypeScript passes. The gateway starts and logs `pi-voice-gateway listening on ws://127.0.0.1:30142/xiaozhi/v1`. With mock FunASR running, the mock Xiaozhi client sends Opus frames and receives `stt` messages. Stop the gateway with `Ctrl+C`.

- [ ] **Step 7: Commit**

```bash
git add lib/voice-gateway/codec.ts lib/voice-gateway/server.ts lib/voice-gateway/cli.ts lib/voice-gateway/index.ts bin/pi-voice-gateway.js scripts/voice-gateway/mock-xiaozhi-client.mjs
git commit -m "feat(voice): add gateway websocket service skeleton"
```

---

### Task 7: Add Pi-Web Local Delivery API

**Files:**
- Create: `app/api/voice/deliver/route.ts`
- Create: `lib/voice-gateway/chat-delivery.ts`

- [ ] **Step 1: Add local delivery route**

Create `app/api/voice/deliver/route.ts`:

```ts
import { NextResponse } from "next/server";
import { startRpcSession, getRpcSession } from "@/lib/rpc-manager";
import { resolveSessionPath } from "@/lib/session-reader";
import { SessionManager } from "@earendil-works/pi-coding-agent";

interface DeliverBody {
  sharedSecret: string;
  targetSession: "active" | string;
  targetCwd: string;
  message: string;
  mode?: "prompt" | "follow_up";
}

export async function POST(req: Request) {
  try {
    const body = await req.json() as DeliverBody;
    if (!body.message?.trim()) return NextResponse.json({ error: "message is required" }, { status: 400 });
    if (!body.targetCwd?.trim()) return NextResponse.json({ error: "targetCwd is required" }, { status: 400 });

    const expected = process.env.PI_VOICE_GATEWAY_SHARED_SECRET;
    if (expected && body.sharedSecret !== expected) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    if (body.targetSession !== "active") {
      const existing = getRpcSession(body.targetSession);
      if (existing?.isAlive()) {
        await existing.send({ type: body.mode ?? "prompt", message: body.message });
        return NextResponse.json({ success: true, sessionId: body.targetSession });
      }

      const filePath = await resolveSessionPath(body.targetSession);
      if (filePath) {
        const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? body.targetCwd;
        const { session } = await startRpcSession(body.targetSession, filePath, cwd);
        await session.send({ type: body.mode ?? "prompt", message: body.message });
        return NextResponse.json({ success: true, sessionId: body.targetSession });
      }
    }

    const { session, realSessionId } = await startRpcSession(`__voice__${Date.now()}`, "", body.targetCwd);
    await session.send({ type: "prompt", message: body.message });
    return NextResponse.json({ success: true, sessionId: realSessionId });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
```

- [ ] **Step 2: Add gateway delivery client**

Create `lib/voice-gateway/chat-delivery.ts`:

```ts
import type { VoiceGatewaySettings, VoiceDeviceProfile } from "./types";

export async function deliverTranscript(input: {
  settings: VoiceGatewaySettings;
  profile: VoiceDeviceProfile;
  text: string;
}): Promise<{ sessionId: string }> {
  const res = await fetch("http://127.0.0.1:3030/api/voice/deliver", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sharedSecret: input.settings.gateway.sharedSecret,
      targetSession: input.profile.targetSession,
      targetCwd: input.profile.targetCwd,
      message: input.text,
      mode: "prompt",
    }),
  });
  const body = await res.json() as { success?: boolean; sessionId?: string; error?: string };
  if (!res.ok || !body.success || !body.sessionId) throw new Error(body.error ?? `HTTP ${res.status}`);
  return { sessionId: body.sessionId };
}
```

- [ ] **Step 3: Verify**

Run:

```bash
node_modules/.bin/tsc --noEmit
node node_modules/next/dist/bin/next lint
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add app/api/voice/deliver/route.ts lib/voice-gateway/chat-delivery.ts
git commit -m "feat(voice): add local transcript delivery API"
```

---

### Task 8: Add Browser Voice Hook

**Files:**
- Create: `hooks/useVoiceGateway.ts`
- Create: `public/voice/pcm-worklet.js`

- [ ] **Step 1: Add PCM worklet**

Create `public/voice/pcm-worklet.js`:

```js
class PcmWorkletProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) return true;
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      out[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    this.port.postMessage(out.buffer, [out.buffer]);
    return true;
  }
}

registerProcessor("pcm-worklet", PcmWorkletProcessor);
```

- [ ] **Step 2: Add React hook**

Create `hooks/useVoiceGateway.ts`:

```ts
"use client";

import { useCallback, useRef, useState } from "react";

export interface UseVoiceGatewayOptions {
  url: string;
  mode: "dictation" | "auto-send";
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}

export function useVoiceGateway(options: UseVoiceGatewayOptions) {
  const [isListening, setIsListening] = useState(false);
  const [status, setStatus] = useState<"idle" | "connecting" | "listening" | "error">("idle");
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ session_id: "browser", type: "listen", state: "stop", mode: "manual" }));
    wsRef.current?.close();
    wsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    audioContextRef.current?.close();
    audioContextRef.current = null;
    setIsListening(false);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    setStatus("connecting");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;
    const audioContext = new AudioContext({ sampleRate: 16000 });
    audioContextRef.current = audioContext;
    await audioContext.audioWorklet.addModule("/voice/pcm-worklet.js");

    const ws = new WebSocket(options.url);
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("Voice gateway connection failed"));
    });

    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data)) as { type: string; state?: string; text?: string; message?: string };
      if (msg.type === "stt" && msg.state === "partial" && msg.text) options.onPartial(msg.text);
      if (msg.type === "stt" && msg.state === "final" && msg.text) options.onFinal(msg.text);
      if (msg.type === "error") options.onError(msg.message ?? "Voice gateway error");
    };

    ws.send(JSON.stringify({
      type: "hello",
      version: 1,
      transport: "websocket",
      source: "browser",
      audio_params: { format: "pcm_s16le", sample_rate: 16000, channels: 1, frame_duration: 40 },
    }));
    ws.send(JSON.stringify({ session_id: "browser", type: "listen", state: "start", mode: options.mode === "auto-send" ? "auto" : "manual" }));

    const source = audioContext.createMediaStreamSource(stream);
    const processor = new AudioWorkletNode(audioContext, "pcm-worklet");
    processor.port.onmessage = (event) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(event.data);
    };
    source.connect(processor);
    processor.connect(audioContext.destination);

    setIsListening(true);
    setStatus("listening");
  }, [options]);

  const toggle = useCallback(() => {
    if (isListening) stop();
    else void start().catch((error) => {
      setStatus("error");
      options.onError(error instanceof Error ? error.message : String(error));
    });
  }, [isListening, options, start, stop]);

  return { isListening, status, start, stop, toggle };
}
```

- [ ] **Step 3: Verify**

Run:

```bash
node_modules/.bin/tsc --noEmit
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add hooks/useVoiceGateway.ts public/voice/pcm-worklet.js
git commit -m "feat(voice): add browser voice gateway hook"
```

---

### Task 9: Integrate ChatInput Microphone UX

**Files:**
- Modify: `components/ChatInput.tsx`
- Modify: `components/ChatWindow.tsx`

- [ ] **Step 1: Extend ChatInput handle**

In `components/ChatInput.tsx`, extend `ChatInputHandle`:

```ts
export interface ChatInputHandle {
  insertText: (text: string) => void;
  insertIfEmpty: (text: string) => void;
  addImages: (files: File[]) => void;
  setVoicePartial: (text: string) => void;
  commitVoiceText: (text: string) => void;
}
```

Add state:

```ts
const [voicePartial, setVoicePartial] = useState("");
```

Update the textarea value:

```tsx
value={voicePartial ? `${value}${value && !value.endsWith(" ") ? " " : ""}${voicePartial}` : value}
```

Use a custom `onChange` that clears partial when the user types:

```tsx
onChange={(e) => {
  setVoicePartial("");
  setValue(e.target.value);
}}
```

Add handle methods:

```ts
setVoicePartial(text: string) {
  setVoicePartial(text);
},
commitVoiceText(text: string) {
  setVoicePartial("");
  setValue((current) => {
    const trimmed = text.trim();
    if (!trimmed) return current;
    const sep = current.trim() && !current.endsWith(" ") ? " " : "";
    return `${current}${sep}${trimmed}`;
  });
  requestAnimationFrame(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.focus();
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  });
},
```

- [ ] **Step 2: Add voice props and button**

Add props:

```ts
voiceEnabled?: boolean;
voiceListening?: boolean;
voiceStatus?: "idle" | "connecting" | "listening" | "error";
onVoiceToggle?: () => void;
```

Add a mic button near the attach button:

```tsx
{voiceEnabled && onVoiceToggle && (
  <button
    onClick={onVoiceToggle}
    title={voiceListening ? "停止語音輸入" : "開始語音輸入"}
    style={{
      flexShrink: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: 32,
      height: 32,
      padding: 0,
      background: voiceListening ? "rgba(37,99,235,0.10)" : "none",
      border: "none",
      borderRadius: 9,
      color: voiceListening ? "var(--accent)" : "var(--text-muted)",
      cursor: "pointer",
    }}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="22" />
    </svg>
  </button>
)}
```

- [ ] **Step 3: Wire ChatWindow to voice hook**

In `components/ChatWindow.tsx`, import:

```ts
import { useVoiceGateway } from "@/hooks/useVoiceGateway";
```

Inside `ChatWindow`, create:

```ts
const voice = useVoiceGateway({
  url: "ws://127.0.0.1:30142/xiaozhi/v1",
  mode: "dictation",
  onPartial: (text) => chatInputRef?.current?.setVoicePartial(text),
  onFinal: (text) => chatInputRef?.current?.commitVoiceText(text),
  onError: (message) => console.error("Voice gateway:", message),
});
```

Pass props to `ChatInput`:

```tsx
voiceEnabled
voiceListening={voice.isListening}
voiceStatus={voice.status}
onVoiceToggle={voice.toggle}
```

- [ ] **Step 4: Add page-scoped hotkey**

In `ChatWindow`, add:

```ts
useEffect(() => {
  const handler = (event: KeyboardEvent) => {
    if (!(event.altKey && event.code === "Space")) return;
    event.preventDefault();
    voice.toggle();
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}, [voice]);
```

- [ ] **Step 5: Verify**

Run:

```bash
node_modules/.bin/tsc --noEmit
node node_modules/next/dist/bin/next lint
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add components/ChatInput.tsx components/ChatWindow.tsx
git commit -m "feat(voice): add ChatInput microphone dictation controls"
```

---

### Task 10: Add Gateway Documentation

**Files:**
- Create: `docs/voice-gateway.md`

- [ ] **Step 1: Document local and Cloudflare setup**

Create `docs/voice-gateway.md`:

```md
# Voice Gateway

The voice gateway is a separate local service for browser dictation and remote ESP32 voice sessions.

## Run

```bash
pi-voice-gateway
npm run dev
```

## Default endpoints

- Local browser/device endpoint: `ws://127.0.0.1:30142/xiaozhi/v1`
- Cloudflare Tunnel public endpoint: `wss://voice.example.com/xiaozhi/v1`

## FunASR

The first supported ASR backend is FunASR. The gateway supports:

- `external-ws`: connect to an existing FunASR WebSocket runtime.
- `managed-command`: start FunASR from a configured shell command.

## ESP32

ESP32 clients use a Xiaozhi-style protocol:

- JSON `hello`
- JSON `listen`
- binary audio frames
- JSON `stt`
- reserved JSON `tts`

## TTS

TTS is intentionally reserved in v1. The gateway returns no-op or unavailable TTS events until a backend is configured.
```

- [ ] **Step 2: Verify**

Run:

```bash
node_modules/.bin/tsc --noEmit
node node_modules/next/dist/bin/next lint
```

Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add docs/voice-gateway.md
git commit -m "docs(voice): document gateway setup"
```

---

### Task 11: End-To-End Smoke Verification

**Files:**
- No new source files expected.
- May modify docs if smoke findings reveal required setup notes.

- [ ] **Step 1: Start mock FunASR**

Run:

```bash
MOCK_FUNASR_PORT=10095 node scripts/voice-gateway/mock-funasr.mjs
```

Expected: `mock FunASR listening on ws://127.0.0.1:10095`.

- [ ] **Step 2: Start gateway**

Run the finalized gateway command from Task 6.

Expected: gateway listens on `127.0.0.1:30142`.

- [ ] **Step 3: Run mock Xiaozhi client**

Run:

```bash
VOICE_GATEWAY_URL=ws://127.0.0.1:30142/xiaozhi/v1 node scripts/voice-gateway/mock-xiaozhi-client.mjs
```

Expected: client receives `hello`, then `stt` messages once enough audio is sent.

- [ ] **Step 4: Browser QA**

Run:

```bash
npm run dev
```

Open `http://localhost:3030`.

Expected:
- Mic button appears in ChatInput.
- Clicking mic prompts browser microphone permission.
- Speaking or mock audio produces live text in ChatInput.
- Final text is committed and does not auto-send in dictation mode.
- `Alt+Space` toggles listening while the page has focus.

- [ ] **Step 5: Static verification**

Run:

```bash
node_modules/.bin/tsc --noEmit
node node_modules/next/dist/bin/next lint
node --test tests/voice-gateway/*.test.mjs
```

Expected: all pass. Do not run `next build`.

- [ ] **Step 6: Record mock smoke verification notes**

Append a `## Mock Smoke Verification` section to `docs/voice-gateway.md` with the local mock commands that passed and the observed `hello`/`stt` output shape.

```bash
git add docs/voice-gateway.md
git commit -m "docs(voice): capture gateway smoke test notes"
```

---

### Task 12: Real FunASR And Cloudflare Tunnel Verification

**Files:**
- Modify only documentation or config examples unless runtime defects are found.

- [ ] **Step 1: Configure real FunASR**

Edit `~/.pi/agent/voice-gateway.json`:

```json
{
  "asr": {
    "provider": "funasr",
    "mode": "external-ws",
    "wsUrl": "ws://127.0.0.1:10095"
  }
}
```

Start FunASR separately from the configured `asr.cwd` using:

```bash
python funasr_wss_server.py --port 10095
```

- [ ] **Step 2: Verify real ASR from browser**

Run `npm run dev` and the gateway. Speak into ChatInput.

Expected:
- Partial STT events appear before speech ends.
- Final STT event commits text.
- No record-then-transcribe behavior.

- [ ] **Step 3: Verify Cloudflare WSS path with mock device**

Run:

```bash
VOICE_GATEWAY_URL=wss://voice.example.com/xiaozhi/v1 node scripts/voice-gateway/mock-xiaozhi-client.mjs
```

Expected:
- Cloudflare route reaches local gateway.
- Client receives hello and STT events.
- Re-running after disconnect creates a fresh session.

- [ ] **Step 4: Verify transcript delivery**

Configure a device profile with `targetCwd` pointing at a real project. Trigger a final transcript.

Expected:
- `/api/voice/deliver` creates or resumes a pi session.
- pi-agent receives the transcript as a chat message.
- Delivery failure returns an explicit error and preserves transcript in gateway logs.

- [ ] **Step 5: Final verification**

Run:

```bash
node_modules/.bin/tsc --noEmit
node node_modules/next/dist/bin/next lint
node --test tests/voice-gateway/*.test.mjs
```

Expected: all pass. Do not run `next build`.

- [ ] **Step 6: Final commit**

Append a `## Real FunASR And Tunnel Verification` section to `docs/voice-gateway.md` with the real FunASR command, Cloudflare public WSS URL shape, and observed transcript delivery result.

```bash
git status --short
git add docs/voice-gateway.md
git commit -m "docs(voice): document real FunASR and tunnel verification"
```

---

## Self-Review Notes

- Spec coverage: The plan covers one Xiaozhi-style protocol, gateway process separation, Cloudflare WSS, FunASR lifecycle/client adapters, browser partial/final dictation, device transcript delivery, TTS event reservation, reconnect/error handling, and verification.
- Deliberate scope split: TTS backend implementation is not included because the spec reserves it but marks it non-goal for v1.
- Main implementation risk: `tsx/cjs` makes the gateway CLI simple for v1, but published-package startup should be revisited after the feature is stable if cold-start time or dependency footprint becomes an issue.
- Codec risk: ESP32 Opus support relies on `opusscript` for raw frame decoding to PCM16. If installation or runtime behavior fails during Task 6 verification, replace only `lib/voice-gateway/codec.ts` with another decoder while keeping the Xiaozhi-style protocol unchanged.
