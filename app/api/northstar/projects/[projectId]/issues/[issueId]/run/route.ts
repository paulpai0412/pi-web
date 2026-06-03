import { spawn } from "child_process";
import { resolve } from "path";

export const dynamic = "force-dynamic";

const NORTHSTAR_ROOT =
  process.env.NORTHSTAR_ROOT ?? "/home/timmypai/apps/northstar";

const VALID_ACTIONS = [
  "start",
  "reconcile",
  "release",
  "repair-runtime",
  "retry-sync",
] as const;

type ValidAction = (typeof VALID_ACTIONS)[number];

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; issueId: string }> }
) {
  const { issueId } = await params;

  if (!/^[a-zA-Z0-9_:/-]+$/.test(issueId)) {
    return new Response(JSON.stringify({ error: "Invalid issueId" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const config = url.searchParams.get("config");

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

  const tsx = resolve(NORTHSTAR_ROOT, "node_modules/.bin/tsx");
  const entrypoint = resolve(NORTHSTAR_ROOT, "src/cli/entrypoint.ts");
  const cliArgs = [
    entrypoint,
    action as ValidAction,
    "--issue",
    issueId,
    "--config",
    resolve(config),
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
