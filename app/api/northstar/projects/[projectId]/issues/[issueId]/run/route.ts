import { spawn } from "child_process";
import { existsSync } from "fs";
import { resolve } from "path";
import { homedir } from "os";

export const dynamic = "force-dynamic";

const NORTHSTAR_ROOT =
  process.env.NORTHSTAR_ROOT ?? "/home/timmypai/apps/northstar";

const VALID_ACTIONS = [
  "start",
  "reconcile",
  "release",
  "repair-runtime",
  "retry-sync",
  "resume",
  "quarantine",
] as const;

type ValidAction = (typeof VALID_ACTIONS)[number];

function resolveConfigPath(configPath: string): string {
  const trimmed = configPath.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return resolve(homedir(), trimmed.slice(2));
  }
  return resolve(trimmed);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; issueId: string }> }
) {
  const { issueId } = await params;

  if (!/^[a-zA-Z0-9_:-]{1,128}$/.test(issueId)) {
    return new Response(JSON.stringify({ error: "Invalid issueId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const config = url.searchParams.get("config");
  const resumeTarget = url.searchParams.get("to");
  const actionReason = url.searchParams.get("reason");

  if (!action || !(VALID_ACTIONS as readonly string[]).includes(action)) {
    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!config) {
    return new Response(JSON.stringify({ error: "config is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (action === "resume") {
    if (resumeTarget !== "ready" && resumeTarget !== "running") {
      return new Response(JSON.stringify({ error: "resume target must be ready or running" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!actionReason || actionReason.trim().length === 0) {
      return new Response(JSON.stringify({ error: "resume reason is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (action === "quarantine" && (!actionReason || actionReason.trim().length === 0)) {
    return new Response(JSON.stringify({ error: "quarantine reason is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Reject paths with traversal sequences
  if (config.includes("..")) {
    return new Response(JSON.stringify({ error: "Invalid config path" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Require .northstar.yaml suffix
  if (!config.endsWith(".northstar.yaml")) {
    return new Response(JSON.stringify({ error: "config must be a .northstar.yaml file" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Verify file exists
  const resolvedConfig = resolveConfigPath(config);
  if (!existsSync(resolvedConfig)) {
    return new Response(JSON.stringify({ error: "Config file not found" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const tsx = resolve(NORTHSTAR_ROOT, "node_modules/.bin/tsx");
  const entrypoint = resolve(NORTHSTAR_ROOT, "src/cli/entrypoint.ts");
  const validAction = action as ValidAction;
  const cliArgs = [
    entrypoint,
    validAction,
    "--issue",
    issueId,
    ...(validAction === "resume"
      ? ["--to", resumeTarget as "ready" | "running", "--reason", (actionReason as string).trim()]
      : []),
    ...(validAction === "quarantine"
      ? ["--reason", (actionReason as string).trim()]
      : []),
    "--config",
    resolvedConfig,
  ];

  let child: ReturnType<typeof spawn> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const closeOnce = () => {
        if (!closed) { closed = true; controller.close(); }
      };

      const encode = (data: unknown) => {
        controller.enqueue(
          new TextEncoder().encode(`data: ${JSON.stringify(data)}\n\n`)
        );
      };

      child = spawn(tsx, cliArgs, { cwd: NORTHSTAR_ROOT });

      child.stdout?.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) encode({ type: "line", stream: "stdout", text: line });
        }
      });

      child.stderr?.on("data", (chunk: Buffer) => {
        for (const line of chunk.toString().split("\n")) {
          if (line.trim()) encode({ type: "line", stream: "stderr", text: line });
        }
      });

      child.on("close", (code) => {
        encode({ type: "exit", code: code ?? 1 });
        closeOnce();
      });

      child.on("error", (err) => {
        encode({ type: "error", message: err.message });
        closeOnce();
      });
    },
    cancel() {
      if (child) {
        child.kill("SIGTERM");
        setTimeout(() => child?.kill("SIGKILL"), 5000);
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
