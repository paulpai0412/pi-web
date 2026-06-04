import "server-only";

import { resolve } from "path";
import { homedir } from "os";

import { createNorthstarLocalApi } from "./local-api-loader";

export interface NorthstarServerApi {
  getProject(): unknown;
  getBoard(): unknown;
  getIssue(issueId: string): unknown;
  listIssueEvents(issueId: string): unknown;
  getWizard(): unknown;
  runIssueAction(request: Record<string, unknown>): Promise<unknown> | unknown;
  runWizardAction(request: Record<string, unknown>): unknown;
}


function resolveConfigPath(configPath: string): string {
  const trimmed = configPath.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return resolve(homedir(), trimmed.slice(2));
  }
  return resolve(trimmed);
}
// The Northstar source location is fixed at build time by the relative import in
// local-api-loader.js (it is bundled by webpack). The *data* — which project and
// runtime DB — is selected per request by the config path below.
export async function getNorthstarServerApi(request: Request): Promise<NorthstarServerApi> {
  const url = new URL(request.url);
  const configPath = url.searchParams.get("config") ?? process.env.NORTHSTAR_CONFIG;
  if (!configPath) {
    throw new Error("NORTHSTAR_CONFIG is required");
  }
  return createNorthstarLocalApi({ configPath: resolveConfigPath(configPath) });
}
