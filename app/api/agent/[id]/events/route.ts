import { createReadStream, statSync } from "fs";

import { resolveSessionPath } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";
import { SessionManager } from "@earendil-works/pi-coding-agent";

export const dynamic = "force-dynamic";

function messageSignature(message: unknown): string {
  try {
    const msg = message as { role?: unknown; timestamp?: unknown };
    return `${String(msg.role ?? "")}:${String(msg.timestamp ?? "")}:${JSON.stringify(message)}`;
  } catch {
    return String(message);
  }
}

function parsePiJsonlMessageEvents(text: string): Array<{ entryId: string | null; message: unknown }> {
  const events: Array<{ entryId: string | null; message: unknown }> = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as { type?: string; id?: string; message?: unknown };
      if (entry.type === "message" && entry.message) {
        events.push({ entryId: entry.id ?? null, message: entry.message });
      }
    } catch {
      // Ignore partially-written or non-message lines; the next poll will retry buffered tails.
    }
  }
  return events;
}

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const filePath = await resolveSessionPath(id);
  if (!filePath) {
    return new Response("Session not found", { status: 404 });
  }

  // Fast path: already-running session
  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const cwd = SessionManager.open(filePath).getHeader()?.cwd ?? process.cwd();
    try {
      ({ session } = await startRpcSession(id, filePath, cwd));
    } catch {
      session = undefined;
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      let unsubscribe: (() => void) | null = null;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let filePoll: ReturnType<typeof setInterval> | null = null;
      let offset = 0;
      let lineBuffer = "";
      const sentMessages = new Set<string>();

      const encode = (data: unknown) => {
        if (closed) return;
        const text = `data: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(new TextEncoder().encode(text));
        } catch {
          cleanup();
        }
      };

      const sendMessageEnd = (message: unknown, entryId?: string | null) => {
        const signature = messageSignature(message);
        if (sentMessages.has(signature)) return;
        sentMessages.add(signature);
        encode({ type: "message_end", message, entryId: entryId ?? undefined });
      };

      // Send initial connected event
      encode({ type: "connected", sessionId: id });

      unsubscribe = session?.onEvent((event) => {
        if (event.type === "message_end" && event.message) {
          sendMessageEnd(event.message);
          return;
        }
        encode(event);
      }) ?? null;

      try {
        offset = statSync(filePath).size;
      } catch (error) {
        encode({ type: "error", errorMessage: `Session file unavailable: ${error}` });
      }

      const flushFileTail = () => {
        if (closed) return;
        try {
          const size = statSync(filePath).size;
          if (size < offset) {
            offset = 0;
            lineBuffer = "";
          }
          if (size <= offset) return;

          const chunks: Buffer[] = [];
          const rs = createReadStream(filePath, { start: offset, end: size - 1 });
          rs.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          rs.on("end", () => {
            if (closed) return;
            offset = size;
            const text = lineBuffer + Buffer.concat(chunks).toString("utf8");
            const lines = text.split(/\r?\n/);
            lineBuffer = lines.pop() ?? "";
            for (const event of parsePiJsonlMessageEvents(lines.join("\n"))) {
              sendMessageEnd(event.message, event.entryId);
            }
          });
          rs.on("error", (error) => encode({ type: "error", errorMessage: String(error) }));
        } catch (error) {
          encode({ type: "error", errorMessage: String(error) });
        }
      };
      filePoll = setInterval(flushFileTail, 1000);

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);

      // Cleanup when client disconnects
      const cleanup = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (filePoll) clearInterval(filePoll);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", cleanup);
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
