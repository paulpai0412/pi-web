import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { DatabaseSync } from "node:sqlite";

import type { AgentMessage, AssistantContentBlock, AssistantMessage, ToolResultMessage } from "@/lib/types";

const opencodeSessionIdPattern = /^ses_[A-Za-z0-9]+$/;
const defaultDatabasePath = join(homedir(), ".local", "share", "opencode", "opencode.db");

type JsonRecord = Record<string, unknown>;

interface OpenCodeRow {
  message_id: string;
  message_created: number;
  message_updated: number;
  message_data: string;
  part_id: string | null;
  part_created: number | null;
  part_updated: number | null;
  part_data: string | null;
}

export interface OpenCodeReadResult {
  messages: AgentMessage[];
  maxUpdatedAt: number;
}

export function findOpenCodeDatabase(): string | null {
  return existsSync(defaultDatabasePath) ? defaultDatabasePath : null;
}

export function isOpenCodeSessionId(sessionId: string): boolean {
  return opencodeSessionIdPattern.test(sessionId);
}

export function readOpenCodeSessionMessages(sessionId: string, sinceUpdatedAt = 0): OpenCodeReadResult {
  if (!isOpenCodeSessionId(sessionId)) return { messages: [], maxUpdatedAt: sinceUpdatedAt };

  const dbPath = findOpenCodeDatabase();
  if (!dbPath) return { messages: [], maxUpdatedAt: sinceUpdatedAt };

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare(`
      SELECT
        m.id AS message_id,
        m.time_created AS message_created,
        m.time_updated AS message_updated,
        m.data AS message_data,
        p.id AS part_id,
        p.time_created AS part_created,
        p.time_updated AS part_updated,
        p.data AS part_data
      FROM message m
      LEFT JOIN part p ON p.message_id = m.id
      WHERE m.session_id = ? AND (m.time_updated > ? OR p.time_updated > ?)
      ORDER BY m.time_created, p.time_created, p.id
    `).all(sessionId, sinceUpdatedAt, sinceUpdatedAt) as unknown as OpenCodeRow[];

    return rowsToMessages(rows, sinceUpdatedAt);
  } finally {
    db.close();
  }
}

function rowsToMessages(rows: OpenCodeRow[], sinceUpdatedAt: number): OpenCodeReadResult {
  const grouped = new Map<string, OpenCodeRow[]>();
  let maxUpdatedAt = sinceUpdatedAt;

  for (const row of rows) {
    maxUpdatedAt = Math.max(maxUpdatedAt, row.message_updated ?? 0, row.part_updated ?? 0);
    const existing = grouped.get(row.message_id) ?? [];
    existing.push(row);
    grouped.set(row.message_id, existing);
  }

  const messages = [...grouped.values()].flatMap(messageRowsToAgentMessages);
  return { messages, maxUpdatedAt };
}

function messageRowsToAgentMessages(rows: OpenCodeRow[]): AgentMessage[] {
  const first = rows[0];
  if (!first) return [];

  const data = parseJsonObject(first.message_data);
  if (!data) return [];
  const role = stringValue(data.role);
  if (role !== "user" && role !== "assistant") return [];

  const parts = rows
    .map((row) => parseJsonObject(row.part_data))
    .filter((part): part is JsonRecord => !!part);

  if (role === "user") {
    const text = parts.map(textFromPart).filter(Boolean).join("\n");
    if (!text) return [];
    return [{
      role: "user",
      content: text,
      timestamp: numberValue(data.time, "created") ?? first.message_created,
    }];
  }

  const provider = stringValue(data.providerID) ?? stringValue(objectValue(data.model)?.providerID) ?? "opencode";
  const model = stringValue(data.modelID) ?? stringValue(objectValue(data.model)?.modelID) ?? "";
  const timestamp = numberValue(data.time, "completed") ?? first.message_updated;
  const content: AssistantContentBlock[] = [];
  const toolResults: ToolResultMessage[] = [];

  for (const part of parts) {
    const type = stringValue(part.type);
    if (type === "reasoning") {
      const thinking = stringValue(part.text);
      if (thinking) content.push({ type: "thinking", thinking });
      continue;
    }
    if (type === "text") {
      const text = stringValue(part.text);
      if (text) content.push({ type: "text", text });
      continue;
    }
    if (type === "tool") {
      const converted = toolMessagesFromPart(part, timestamp);
      if (converted) {
        content.push(converted.call);
        toolResults.push(converted.result);
      }
    }
  }

  if (content.length === 0) return toolResults;

  const assistant: AssistantMessage = {
    role: "assistant",
    content,
    model,
    provider,
    stopReason: stringValue(data.finish) ?? undefined,
    timestamp,
    usage: usageFromMessageData(data),
  };
  return [assistant, ...toolResults];
}

function toolMessagesFromPart(part: JsonRecord, timestamp: number): { call: AssistantContentBlock; result: ToolResultMessage } | null {
  const state = objectValue(part.state);
  const callId = stringValue(part.callID) ?? stringValue(part.id);
  const toolName = stringValue(part.tool);
  if (!state || !callId || !toolName) return null;

  const input = objectValue(state.input) ?? {};
  const output = stringValue(state.output) ?? stringValue(objectValue(state.metadata)?.output) ?? "";

  return {
    call: {
      type: "toolCall",
      toolCallId: callId,
      toolName,
      input,
    },
    result: {
      role: "toolResult",
      toolCallId: callId,
      toolName,
      content: [{ type: "text", text: output }],
      isError: stringValue(state.status) === "error",
      timestamp: numberValue(objectValue(state.time), "end") ?? timestamp,
    },
  };
}

function usageFromMessageData(data: JsonRecord): AssistantMessage["usage"] | undefined {
  const tokens = objectValue(data.tokens);
  if (!tokens) return undefined;
  const cache = objectValue(tokens.cache);
  return {
    input: numberValue(tokens, "input") ?? 0,
    output: numberValue(tokens, "output") ?? 0,
    cacheRead: numberValue(cache, "read") ?? 0,
    cacheWrite: numberValue(cache, "write") ?? 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: numberValue(data, "cost") ?? 0,
    },
  };
}

function textFromPart(part: JsonRecord): string {
  const type = stringValue(part.type);
  if (type === "text") return stringValue(part.text) ?? "";
  return "";
}

function parseJsonObject(value: unknown): JsonRecord | null {
  if (typeof value !== "string") return objectValue(value);
  try {
    return objectValue(JSON.parse(value));
  } catch {
    return null;
  }
}

function objectValue(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberValue(value: unknown, key: string): number | null {
  const object = objectValue(value);
  const nested = object?.[key];
  return typeof nested === "number" && Number.isFinite(nested) ? nested : null;
}
