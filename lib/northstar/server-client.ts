import "server-only";

import { existsSync } from "fs";
import { resolve } from "path";
import { pathToFileURL } from "url";

export interface NorthstarServerApi {
  getProject(): unknown;
  getBoard(): unknown;
  getIssue(issueId: string): unknown;
  listIssueEvents(issueId: string): unknown;
  getWizard(): unknown;
  runIssueAction(request: Record<string, unknown>): Promise<unknown> | unknown;
  runWizardAction(request: Record<string, unknown>): unknown;
}

type NorthstarLocalApiModule = {
  createNorthstarLocalApi(input: { configPath: string }): NorthstarServerApi;
};

const DEFAULT_NORTHSTAR_ROOT = "/home/timmypai/.codex/worktrees/0536/northstar";

export async function getNorthstarServerApi(request: Request): Promise<NorthstarServerApi> {
  const url = new URL(request.url);
  const configPath = url.searchParams.get("config") ?? process.env.NORTHSTAR_CONFIG;
  if (!configPath) {
    throw new Error("NORTHSTAR_CONFIG is required");
  }

  const northstarRoot = process.env.NORTHSTAR_ROOT ?? DEFAULT_NORTHSTAR_ROOT;
  const modulePath = resolve(northstarRoot, "src/operator-dashboard/local-api.ts");
  if (!existsSync(modulePath)) {
    throw new Error(`Northstar local API not found at ${modulePath}`);
  }

  const mod = (await import(pathToFileURL(modulePath).href)) as NorthstarLocalApiModule;
  return mod.createNorthstarLocalApi({ configPath: resolve(configPath) });
}
