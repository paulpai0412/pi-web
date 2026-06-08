import assert from "node:assert/strict";
import { test } from "node:test";

const { formatAssistantError } = await import("../lib/message-errors.js");

test("formats assistant errorMessage for display", () => {
  assert.equal(
    formatAssistantError({
      role: "assistant",
      content: [],
      model: "gpt-5.5",
      provider: "github-copilot",
      stopReason: "error",
      errorMessage: "OpenAI API error (429): 429 quota exceeded\n",
    }),
    "OpenAI API error (429): 429 quota exceeded",
  );
});

test("falls back to stopReason when assistant has no errorMessage", () => {
  assert.equal(
    formatAssistantError({
      role: "assistant",
      content: [],
      model: "gpt-5.5",
      provider: "github-copilot",
      stopReason: "error",
    }),
    "Assistant stopped with an error.",
  );
});

test("returns null for normal assistant messages", () => {
  assert.equal(
    formatAssistantError({
      role: "assistant",
      content: [{ type: "text", text: "ok" }],
      model: "gpt-5.5",
      provider: "github-copilot",
      stopReason: "stop",
    }),
    null,
  );
});
