"use client";

import { WORKSPACE_VIEWS } from "./workspace-views";

// Top-bar workspace tab row: "Chat" plus every view from the registry.
// `active` is a workspace-view id ("chat" or a WORKSPACE_VIEWS id).

const chatIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
  </svg>
);

export function WorkspaceTabs({
  active,
  onSelect,
}: {
  active: string;
  onSelect: (id: string) => void;
}) {
  const tabs = [
    { id: "chat", label: "Chat", icon: chatIcon },
    ...WORKSPACE_VIEWS.map((view) => ({ id: view.id, label: view.label, icon: view.icon })),
  ];

  return (
    <div style={{ display: "flex", alignItems: "stretch", height: "100%" }}>
      {tabs.map((tab) => {
        const isActive = active === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => onSelect(tab.id)}
            title={tab.label}
            aria-pressed={isActive}
            style={{
              display: "flex", alignItems: "center", gap: 6,
              height: "100%", padding: "0 12px",
              background: isActive ? "var(--bg-selected)" : "none",
              border: "none",
              borderTop: isActive ? "2px solid var(--accent)" : "2px solid transparent",
              borderRight: "1px solid var(--border)",
              cursor: "pointer",
              color: isActive ? "var(--text)" : "var(--text-muted)",
              fontSize: 11, whiteSpace: "nowrap", transition: "color 0.1s, background 0.1s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.color = "var(--text)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = isActive ? "var(--text)" : "var(--text-muted)"; }}
          >
            <span style={{ display: "flex", color: isActive ? "var(--accent)" : "var(--text-dim)" }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
