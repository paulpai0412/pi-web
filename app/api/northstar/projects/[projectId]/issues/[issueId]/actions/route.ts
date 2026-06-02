import { NextResponse } from "next/server";

import { getNorthstarServerApi } from "@/lib/northstar/server-client";

export async function POST(req: Request, context: { params: Promise<{ issueId: string }> }) {
  try {
    const { issueId } = await context.params;
    const decodedIssueId = decodeURIComponent(issueId);
    const body = (await req.json()) as Record<string, unknown>;
    const api = await getNorthstarServerApi(req);
    const response = await api.runIssueAction({ ...body, issueId: decodedIssueId });
    return NextResponse.json(response);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
