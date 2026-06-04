import { createReadStream, existsSync, readdirSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { createInterface } from "readline";

import type { AgentMessage, AssistantMessage, ToolResultMessage } from "@/lib/types";

const codexSessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxSessionSearchDepth = 5;

type JsonRecord = Record<string, unknown>;

export interface CodexParseState {
  toolNamesByCallId: Map<string, string>;
  ended: boolean;
  model: string;
  provider: string;
}

export interface CodexParseResult {
  messages: AgentMessage[];
  ended: boolean;
}

export function createCodexParseState(): CodexParseState {
  return {
    toolNamesByCallId: new Map(),
    ended: false,
    model: "",
    provider: "codex",
  };
}

export function findCodexSessionFile(sessionId: string): string | null {
  if (!codexSessionIdPattern.test(sessionId)) return null;

  const root = join(homedir(), ".codex", "sessions");
  if (!existsSync(root)) return null;
  return findSessionFile(root, sessionId, 0);
}

export async function readCodexSessionMessages(filePath: string, state = createCodexParseState(), endOffset?: number): Promise<CodexParseResult> {
  const messages: AgentMessage[] = [];
  const rl = createInterface({
    input: createReadStream(filePath, endOffset === undefined ? { encoding: "utf8" } : { encoding: "utf8", start: 0, end: Math.max(0, endOffset - 1) }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    messages.push(...parseCodexJsonlLine(line, state));
  }

  return { messages, ended: state.ended };
}

export function parseCodexJsonlLines(chunk: string, state: CodexParseState): AgentMessage[] {
  return chunk.split(/\r?\n/).flatMap((line) => parseCodexJsonlLine(line, state));
}

function findSessionFile(dir: string, sessionId: string, depth: number): string | null {
  if (depth > maxSessionSearchDepth) return null;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return null;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    let stats;
    try {
      stats = statSync(fullPath);
    } catch {
      continue;
    }

    if (stats.isFile() && entry.endsWith(`${sessionId}.jsonl`)) {
      return fullPath;
    }
    if (stats.isDirectory()) {
      const found = findSessionFile(fullPath, sessionId, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

function parseCodexJsonlLine(line: string, state: CodexParseState): AgentMessage[] {
  const trimmed = line.trim();
  if (!trimmed) return [];

  let row: JsonRecord;
  try {
    row = JSON.parse(trimmed) as JsonRecord;
  } catch {
    return [];
  }

  if (row.type === "session_meta") {
    const payload = objectValue(row.payload);
    state.model = stringValue(payload?.model_provider) ?? state.model;
    return [];
  }

  if (row.type === "event_msg") {
    const payload = objectValue(row.payload);
    if (payload?.type === "task_complete") state.ended = true;
    return [];
  }

  if (row.type !== "response_item") return [];
  const payload = objectValue(row.payload);
  if (!payload) return [];

  if (payload.type === "message") {
    return messageFromResponseItem(payload, row.timestamp, state);
  }
  if (payload.type === "function_call" || payload.type === "custom_tool_call") {
    return toolCallFromResponseItem(payload, row.timestamp, state);
  }
  if (payload.type === "function_call_output" || payload.type === "custom_tool_call_output") {
    return toolResultFromResponseItem(payload, row.timestamp, state);
  }

  return [];
}

function messageFromResponseItem(payload: JsonRecord, timestamp: unknown, state: CodexParseState): AgentMessage[] {
  const role = stringValue(payload.role);
  if (role !== "user" && role !== "assistant") return [];

  const text = textFromContent(payload.content);
  if (!text || isCodexContextOnlyMessage(text)) return [];

  if (role === "user") {
    return [{
      role: "user",
      content: text,
      timestamp: timestampMs(timestamp),
    }];
  }

  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text }],
    model: state.model,
    provider: state.provider,
    timestamp: timestampMs(timestamp),
  };
  return [message];
}

function toolCallFromResponseItem(payload: JsonRecord, timestamp: unknown, state: CodexParseState): AgentMessage[] {
  const callId = stringValue(payload.call_id) ?? stringValue(payload.id);
  if (!callId) return [];

  const toolName = stringValue(payload.name) ?? stringValue(payload.tool_name) ?? stringValue(payload.type) ?? "tool";
  state.toolNamesByCallId.set(callId, toolName);

  const message: AssistantMessage = {
    role: "assistant",
    content: [{
      type: "toolCall",
      toolCallId: callId,
      toolName,
      input: objectFromJsonLike(payload.arguments) ?? objectFromJsonLike(payload.input) ?? {},
    }],
    model: state.model,
    provider: state.provider,
    timestamp: timestampMs(timestamp),
  };
  return [message];
}

function toolResultFromResponseItem(payload: JsonRecord, timestamp: unknown, state: CodexParseState): AgentMessage[] {
  const callId = stringValue(payload.call_id) ?? stringValue(payload.id);
  if (!callId) return [];

  const output = textFromUnknown(payload.output) ?? textFromContent(payload.content) ?? "";
  const message: ToolResultMessage = {
    role: "toolResult",
    toolCallId: callId,
    toolName: state.toolNamesByCallId.get(callId),
    content: [{ type: "text", text: output }],
    timestamp: timestampMs(timestamp),
  };
  return [message];
}

function textFromContent(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;

  const parts = content.flatMap((item) => {
    const block = objectValue(item);
    if (!block) return [];
    const type = stringValue(block.type);
    if (type === "input_text" || type === "output_text" || type === "text") {
      const text = stringValue(block.text);
      return text ? [text] : [];
    }
    return [];
  });

  return parts.length > 0 ? parts.join("\n") : null;
}

function textFromUnknown(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return null;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function objectFromJsonLike(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { value: parsed };
  } catch {
    return { value };
  }
}

function objectValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function timestampMs(value: unknown): number | undefined {
  const text = stringValue(value);
  if (!text) return undefined;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isCodexContextOnlyMessage(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.startsWith("<environment_context>") && trimmed.endsWith("</environment_context>");
}
