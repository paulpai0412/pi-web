import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../components/northstar/NorthstarBoard.tsx", import.meta.url), "utf8");

test("keeps floating chat panel mounted while switching Northstar context tabs", () => {
  assert.match(source, /data-northstar-context-panel="chat"/);
  assert.match(source, /display:\s*contextTab === "chat" \? "block" : "none"/);
  assert.doesNotMatch(source, /contextTab === "chat" \?\s*\(\s*chatPanel/);
});
