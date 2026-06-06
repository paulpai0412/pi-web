import { spawn, type ChildProcessByStdio } from "child_process";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { homedir } from "os";
import type { Readable } from "stream";

export const dynamic = "force-dynamic";

function resolveConfigPath(configPath: string): string {
  const trimmed = configPath.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return resolve(homedir(), trimmed.slice(2));
  }
  return resolve(trimmed);
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { config?: unknown; command?: unknown } | null;
  const config = typeof body?.config === "string" ? body.config : "";
  const command = typeof body?.command === "string" ? body.command : "";

  if (!config) return jsonError("config is required");
  if (config.includes("..")) return jsonError("Invalid config path");
  if (!config.endsWith(".northstar.yaml")) return jsonError("config must be a .northstar.yaml file");

  const resolvedConfig = resolveConfigPath(config);
  if (!existsSync(resolvedConfig)) return jsonError("Config file not found");

  const trimmedCommand = command.trim();
  if (!trimmedCommand) return jsonError("command is required");

  const cwd = dirname(resolvedConfig);
  const shell = process.env.SHELL || "/bin/sh";
  let child: ChildProcessByStdio<null, Readable, Readable> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      const write = (event: unknown) => {
        if (!closed) controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };
      const close = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      write({ type: "start", cwd, shell, command: trimmedCommand });
      const runningChild = spawn(shell, ["-lc", trimmedCommand], {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child = runningChild;

      runningChild.stdout.on("data", (chunk: Buffer) => write({ type: "stdout", text: chunk.toString() }));
      runningChild.stderr.on("data", (chunk: Buffer) => write({ type: "stderr", text: chunk.toString() }));
      runningChild.on("close", (code, signal) => {
        write({ type: "exit", code: code ?? null, signal: signal ?? null });
        close();
      });
      runningChild.on("error", (error) => {
        write({ type: "error", message: error.message });
        close();
      });
    },
    cancel() {
      if (!child || child.killed) return;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child && !child.killed) child.kill("SIGKILL");
      }, 5000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
