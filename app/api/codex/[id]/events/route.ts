import { createReadStream, statSync } from "fs";

import {
  createCodexParseState,
  findCodexSessionFile,
  parseCodexJsonlLines,
  readCodexSessionMessages,
} from "@/lib/codex/session-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const filePath = findCodexSessionFile(id);
  if (!filePath) {
    return new Response(JSON.stringify({ error: "Codex session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const state = createCodexParseState();
  let offset = 0;
  let lineBuffer = "";
  let closed = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      send({ type: "connected", adapter: "codex", sessionId: id });

      try {
        const initialSize = statSync(filePath).size;
        const initial = await readCodexSessionMessages(filePath, state, initialSize);
        offset = initialSize;
        for (const message of initial.messages) {
          send({ type: "message_end", message });
        }
        if (initial.ended) {
          send({ type: "agent_end" });
          closed = true;
          controller.close();
          return;
        }
      } catch (error) {
        send({ type: "error", errorMessage: String(error) });
      }

      timer = setInterval(() => {
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
            offset = size;
            const text = lineBuffer + Buffer.concat(chunks).toString("utf8");
            const lines = text.split(/\r?\n/);
            lineBuffer = lines.pop() ?? "";
            for (const message of parseCodexJsonlLines(lines.join("\n"), state)) {
              send({ type: "message_end", message });
            }
            if (state.ended) {
              send({ type: "agent_end" });
              if (timer) clearInterval(timer);
              closed = true;
              controller.close();
            }
          });
          rs.on("error", (error) => send({ type: "error", errorMessage: String(error) }));
        } catch (error) {
          send({ type: "error", errorMessage: String(error) });
        }
      }, 2000);
    },
    cancel() {
      closed = true;
      if (timer) clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
