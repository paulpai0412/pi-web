import {
  findOpenCodeDatabase,
  isOpenCodeSessionId,
  readOpenCodeSessionMessages,
} from "@/lib/opencode/session-reader";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!isOpenCodeSessionId(id) || !findOpenCodeDatabase()) {
    return new Response(JSON.stringify({ error: "OpenCode session not found" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  let sinceUpdatedAt = 0;
  let closed = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const sentKeys = new Set<string>();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      const flush = () => {
        try {
          const result = readOpenCodeSessionMessages(id, sinceUpdatedAt);
          sinceUpdatedAt = result.maxUpdatedAt;
          for (const message of result.messages) {
            const key = `${message.role}:${message.timestamp ?? ""}:${JSON.stringify(message)}`;
            if (sentKeys.has(key)) continue;
            sentKeys.add(key);
            send({ type: "message_end", message });
          }
        } catch (error) {
          send({ type: "error", errorMessage: String(error) });
        }
      };

      send({ type: "connected", adapter: "opencode", sessionId: id });
      flush();
      timer = setInterval(flush, 2000);
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
