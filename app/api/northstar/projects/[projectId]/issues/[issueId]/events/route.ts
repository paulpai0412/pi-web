import { NextResponse } from "next/server";

import { getNorthstarServerApi } from "@/lib/northstar/server-client";

export async function GET(req: Request, context: { params: Promise<{ issueId: string }> }) {
  try {
    const { issueId } = await context.params;
    const api = await getNorthstarServerApi(req);
    return NextResponse.json({ events: api.listIssueEvents(issueId) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
