import type { ReactNode } from "react";

import { NorthstarBoard } from "./NorthstarBoard";

// Registry of non-chat workspace views shown in the top-bar tabs.
//
// To add a future Northstar tab, append an entry here — no AppShell edits needed.
// This file is Northstar-owned and additive, so upstream pi-web upgrades never
// touch it. See docs/northstar-integration.md.

export interface WorkspaceViewContext {
  activeCwd: string | null;
}

export interface WorkspaceView {
  id: string;
  label: string;
  icon: ReactNode;
  render: (ctx: WorkspaceViewContext) => ReactNode;
}

const northstarIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="8" y1="9" x2="16" y2="9" />
    <line x1="8" y1="13" x2="14" y2="13" />
    <line x1="8" y1="17" x2="12" y2="17" />
  </svg>
);

export const WORKSPACE_VIEWS: WorkspaceView[] = [
  {
    id: "northstar",
    label: "Northstar",
    icon: northstarIcon,
    render: ({ activeCwd }) => (
      <NorthstarBoard configPath={activeCwd ? `${activeCwd}/.northstar.yaml` : null} />
    ),
  },
];

export function renderWorkspaceView(id: string, ctx: WorkspaceViewContext): ReactNode {
  return WORKSPACE_VIEWS.find((view) => view.id === id)?.render(ctx) ?? null;
}
