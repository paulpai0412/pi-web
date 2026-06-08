// Board-only Northstar local API.
//
// This uses the published package boundary instead of importing from a sibling
// repo path. Keep this wrapper board-only so pi-web does not bundle Northstar's
// full orchestrator/host-adapter dependency chain.

import { createNorthstarBoardOnlyLocalApi } from "@northstar/runtime/operator-dashboard/board-only-local-api";

export function createNorthstarLocalApi(input) {
  const api = createNorthstarBoardOnlyLocalApi(input);
  const unsupported = (name) => () => {
    throw new Error(`Northstar "${name}" is not available in pi-web board-only mode`);
  };

  return {
    getProject: api.getProject,
    getBoard: api.getBoard,
    getIssue: api.getIssue,
    listIssueEvents: api.listIssueEvents,
    getWizard: unsupported("getWizard"),
    runIssueAction: unsupported("runIssueAction"),
    runWizardAction: unsupported("runWizardAction"),
  };
}
