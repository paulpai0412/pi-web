// Board-only Northstar local API.
//
// This imports ONLY Northstar's read-model + store + config closure — every file
// in that closure imports nothing but relative paths and node: builtins, so webpack
// bundles it cleanly. It deliberately does NOT import Northstar's local-api.ts,
// whose orchestrator/host-adapter chain does `import("@earendil-works/pi-coding-agent")`
// — a host-provided dependency webpack cannot resolve from out-of-tree source.
// See docs/northstar-integration.md.

import { loadConfig } from "../../../northstar/src/config/load-config.ts";
import { normalizeRuntimePath } from "../../../northstar/src/adapters/platform/paths.ts";
import { SqliteControlPlaneStore } from "../../../northstar/src/runtime/store.ts";
import { buildNorthstarBoard, buildNorthstarIssueDetail, runEventForHistory } from "../../../northstar/src/operator-dashboard/read-model.ts";
import { defaultNorthstarProjectCapabilities } from "../../../northstar/src/operator-dashboard/models.ts";

function projectSummaryForConfig(config, configPath) {
  const projectId = config.github.project?.projectId ?? config.project.name;
  return {
    id: projectId,
    projectId,
    name: config.project.name,
    root: config.project.root,
    repo: config.github.repo,
    hostAdapter: config.runtime.hostAdapter,
    configPath,
    runtimeDbPath: normalizeRuntimePath(config.project.root, config.runtime.dbPath),
    capabilities: defaultNorthstarProjectCapabilities,
  };
}

function readWithStore(config, read) {
  const store = SqliteControlPlaneStore.open(
    normalizeRuntimePath(config.project.root, config.runtime.dbPath),
  );
  try {
    return read(store);
  } finally {
    store.close();
  }
}

export function createNorthstarLocalApi(input) {
  const readConfig = () => loadConfig(input.configPath);
  const unsupported = (name) => () => {
    throw new Error(`Northstar "${name}" is not available in pi-web board-only mode`);
  };

  return {
    getProject() {
      return projectSummaryForConfig(readConfig(), input.configPath);
    },
    getBoard() {
      const config = readConfig();
      return readWithStore(config, (store) => {
        const issues = store.listIssues();
        return buildNorthstarBoard({
          project: projectSummaryForConfig(config, input.configPath),
          issues,
          historiesByIssueId: store.listHistoriesByIssueId(issues.map((issue) => issue.issue_id)),
          now: new Date().toISOString(),
        });
      });
    },
    getIssue(issueId) {
      const config = readConfig();
      return readWithStore(config, (store) => {
        const snapshot = store.getIssue(issueId);
        const history = store.listHistory(issueId);
        return buildNorthstarIssueDetail({
          project: projectSummaryForConfig(config, input.configPath),
          snapshot,
          history,
          now: new Date().toISOString(),
        });
      });
    },
    listIssueEvents(issueId) {
      const config = readConfig();
      return readWithStore(config, (store) => {
        return store.listHistory(issueId).map(runEventForHistory);
      });
    },
    getWizard: unsupported("getWizard"),
    runIssueAction: unsupported("runIssueAction"),
    runWizardAction: unsupported("runWizardAction"),
  };
}
