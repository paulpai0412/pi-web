import { NextResponse } from "next/server";

import { getNorthstarServerApi } from "@/lib/northstar/server-client";

export async function GET(req: Request) {
  try {
    const api = await getNorthstarServerApi(req);
    return NextResponse.json({ projects: [api.getProject()] });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

