import { NextResponse } from "next/server";
import { listAllSessions } from "@/lib/session-reader";
import { listRpcSessionLiveStates } from "@/lib/rpc-manager";

export async function GET() {
  try {
    const sessions = await listAllSessions();
    const liveStates = listRpcSessionLiveStates();
    const enriched = sessions.map((session) => ({
      ...session,
      agentState: liveStates[session.id] ?? { running: false, isStreaming: false, isCompacting: false },
    }));
    return NextResponse.json({ sessions: enriched });
  } catch (error) {
    return NextResponse.json(
      { error: String(error) },
      { status: 500 }
    );
  }
}
