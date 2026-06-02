"use client";

import type { ComponentType } from "react";

type NorthstarDashboardProps = {
  configPath: string | null;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports -- keep external TSX runtime-mounted without typechecking it from the Northstar worktree root
const { NorthstarDashboard } = require("../../../../.codex/worktrees/0536/northstar/integrations/pi-web/components/NorthstarDashboard") as {
  NorthstarDashboard: ComponentType<NorthstarDashboardProps>;
};

export { NorthstarDashboard };
