import { NextResponse } from "next/server";

import { getNorthstarServerApi } from "@/lib/northstar/server-client";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const api = await getNorthstarServerApi(req);
    return NextResponse.json(api.runWizardAction(body));
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
