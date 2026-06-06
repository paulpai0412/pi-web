import { execFileSync, spawn, type ChildProcessByStdio } from "child_process";
import { existsSync, readFileSync } from "fs";
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

interface WatchLockRecord {
  pid: number;
  heartbeat_at: string;
  project_root: string;
  config_path: string;
  host: string;
  lease_id: string;
}

interface WatchProcessInfo {
  pid: number;
  ppid: number;
  stat: string;
  elapsed: string;
  command: string;
  lockOwner: boolean;
}

function parseConfig(config: unknown): { config: string; resolvedConfig: string; cwd: string } | Response {
  const value = typeof config === "string" ? config : "";
  if (!value) return jsonError("config is required");
  if (value.includes("..")) return jsonError("Invalid config path");
  if (!value.endsWith(".northstar.yaml")) return jsonError("config must be a .northstar.yaml file");

  const resolvedConfig = resolveConfigPath(value);
  if (!existsSync(resolvedConfig)) return jsonError("Config file not found");
  return { config: value, resolvedConfig, cwd: dirname(resolvedConfig) };
}

function readWatchLock(cwd: string): WatchLockRecord | null {
  try {
    return JSON.parse(readFileSync(resolve(cwd, ".northstar/runtime/watch.lock"), "utf8")) as WatchLockRecord;
  } catch {
    return null;
  }
}

function pidAlive(pid: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function listProcesses(): Array<{ pid: number; ppid: number; stat: string; elapsed: string; command: string }> {
  try {
    const output = execFileSync("ps", ["-eo", "pid=,ppid=,stat=,etime=,cmd="], { encoding: "utf8" });
    return output.split("\n").flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/.exec(line);
      if (!match) return [];
      return [{
        pid: Number(match[1]),
        ppid: Number(match[2]),
        stat: match[3],
        elapsed: match[4],
        command: match[5],
      }];
    });
  } catch {
    return [];
  }
}

function watchProcessesForConfig(resolvedConfig: string, lockPid?: number): WatchProcessInfo[] {
  const processes = listProcesses();
  return processes
    .filter((proc) => {
      if (proc.pid === process.pid) return false;
      if (proc.command.includes(resolvedConfig) && /\bwatch\b/.test(proc.command) && /northstar|entrypoint\.ts|tsx/.test(proc.command)) return true;
      return lockPid !== undefined && proc.pid === lockPid;
    })
    .map((proc) => ({
      ...proc,
      lockOwner: lockPid !== undefined && proc.pid === lockPid,
    }));
}

function watchStatus(resolvedConfig: string, cwd: string) {
  const lock = readWatchLock(cwd);
  const heartbeatAgeSeconds = lock ? Math.max(0, Math.round((Date.now() - Date.parse(lock.heartbeat_at)) / 1000)) : null;
  const lockPidAlive = lock ? pidAlive(lock.pid) : false;
  const processes = watchProcessesForConfig(resolvedConfig, lock?.pid);
  return {
    running: lockPidAlive || processes.length > 0,
    lock,
    lockPidAlive,
    heartbeatAgeSeconds,
    processes,
    lockPath: resolve(cwd, ".northstar/runtime/watch.lock"),
  };
}

function childPidsByParent(processes: ReturnType<typeof listProcesses>): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const proc of processes) {
    const children = map.get(proc.ppid) ?? [];
    children.push(proc.pid);
    map.set(proc.ppid, children);
  }
  return map;
}

function collectProcessTree(rootPids: number[]): number[] {
  const childrenByParent = childPidsByParent(listProcesses());
  const seen = new Set<number>();
  const stack = [...rootPids];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (!pid || seen.has(pid) || pid === process.pid) continue;
    seen.add(pid);
    stack.push(...(childrenByParent.get(pid) ?? []));
  }
  return [...seen].sort((a, b) => b - a);
}

function killWatchProcesses(resolvedConfig: string, cwd: string, force: boolean) {
  const status = watchStatus(resolvedConfig, cwd);
  const rootPids = [
    ...(status.lock ? [status.lock.pid] : []),
    ...status.processes.map((proc) => proc.pid),
  ];
  const pids = collectProcessTree([...new Set(rootPids)]);
  const signal = force ? "SIGKILL" : "SIGTERM";
  const results = pids.map((pid) => {
    try {
      process.kill(pid, signal);
      return { pid, signal, ok: true };
    } catch (error) {
      return { pid, signal, ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
  return { before: status, results };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = parseConfig(url.searchParams.get("config"));
  if (parsed instanceof Response) return parsed;
  return Response.json(watchStatus(parsed.resolvedConfig, parsed.cwd));
}

export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const body = await req.json().catch(() => null) as { config?: unknown; force?: unknown } | null;
  const parsed = parseConfig(body?.config ?? url.searchParams.get("config"));
  if (parsed instanceof Response) return parsed;
  const force = body?.force === true || url.searchParams.get("force") === "true";
  return Response.json(killWatchProcesses(parsed.resolvedConfig, parsed.cwd, force));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { config?: unknown; command?: unknown } | null;
  const parsed = parseConfig(body?.config);
  if (parsed instanceof Response) return parsed;
  const { cwd, resolvedConfig } = parsed;
  const command = typeof body?.command === "string" ? body.command : "";

  const trimmedCommand = command.trim();
  if (!trimmedCommand) return jsonError("command is required");
  const status = watchStatus(resolvedConfig, cwd);
  if (status.running && /(?:^|\s)watch(?:\s|$)/.test(trimmedCommand)) {
    return new Response(JSON.stringify({ error: "Northstar watch is already running", status }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
  }

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
        detached: true,
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
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      setTimeout(() => {
        if (!child || child.killed) return;
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
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
