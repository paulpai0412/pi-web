import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const sessionsRouteSource = readFileSync(new URL("../app/api/sessions/[id]/route.ts", import.meta.url), "utf8");
const agentRouteSource = readFileSync(new URL("../app/api/agent/[id]/route.ts", import.meta.url), "utf8");

test("session includeState derives running from live runtime state, not wrapper liveness", () => {
  assert.match(sessionsRouteSource, /const\s+liveState\s*=\s*rpc\.getLiveState\(\)/);
  assert.match(sessionsRouteSource, /agentState\s*=\s*\{\s*running:\s*liveState\.running,\s*state\s*\}/s);
  assert.doesNotMatch(sessionsRouteSource, /agentState\s*=\s*\{\s*running:\s*true,\s*state\s*\}/s);
});

test("agent state endpoint reports running from live runtime state", () => {
  assert.match(agentRouteSource, /const\s+liveState\s*=\s*session\.getLiveState\(\)/);
  assert.match(agentRouteSource, /return\s+NextResponse\.json\(\{\s*running:\s*liveState\.running,\s*state\s*\}\)/s);
  assert.doesNotMatch(agentRouteSource, /return\s+NextResponse\.json\(\{\s*running:\s*true,\s*state\s*\}\)/s);
});
