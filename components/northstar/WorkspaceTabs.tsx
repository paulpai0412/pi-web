"use client";

import { WORKSPACE_VIEWS } from "./workspace-views";

const chatIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z" />
  </svg>
);

// Top-bar workspace tab row. Chat has a dedicated full-size workspace, while
// registry-owned views such as Northstar can also embed compact chat panels.

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
