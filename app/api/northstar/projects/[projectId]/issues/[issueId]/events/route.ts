import { NextResponse } from "next/server";

import { getNorthstarServerApi } from "@/lib/northstar/server-client";

export async function GET(req: Request, context: { params: Promise<{ issueId: string }> }) {
  try {
    const { issueId } = await context.params;
    const decodedIssueId = decodeURIComponent(issueId);
    const api = await getNorthstarServerApi(req);
    return NextResponse.json({ events: api.listIssueEvents(decodedIssueId) });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
