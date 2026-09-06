import type { RuntimeKind } from "@pi-ling/contracts";
import {
  ChevronsRight,
  MoreHorizontal,
  PanelLeftOpen,
  PanelRight,
  Plus,
} from "lucide-react";
import { useState } from "react";

export function AppTitleBar() {
  return (
    <header className="app-titlebar">
      <nav className="application-menu" aria-label="Application menu">
        <span>File</span>
        <span>Edit</span>
        <span>View</span>
        <span>Help</span>
      </nav>
      <div className="window-title">
        <span className="window-mark">π</span>
        <span>pi-ling</span>
      </div>
    </header>
  );
}

export function AgentPaneToolbar(props: {
  title?: string;
  runtimeKind: RuntimeKind;
  sidebarCollapsed: boolean;
  rightPanelOpen: boolean;
  onShowSidebar: () => void;
  onToggleRightPanel: () => void;
}) {
  return (
    <header className="pane-toolbar agent-pane-toolbar">
      <div className="toolbar-leading">
        {props.sidebarCollapsed ? (
          <button
            className="icon-button"
            type="button"
            title="Show sidebar"
            aria-label="Show sidebar"
            onClick={props.onShowSidebar}
          >
            <PanelLeftOpen />
          </button>
        ) : null}
      </div>
      <div className="pane-title" title={props.title}>
        {props.title ?? "New agent"}
      </div>
      <div className="toolbar-actions">
        <span className="runtime-indicator">
          {props.runtimeKind === "dsh" ? "DSH" : "Native"}
        </span>
        <button className="icon-button" type="button" disabled aria-label="More">
          <MoreHorizontal />
        </button>
        <button
          className={`icon-button ${props.rightPanelOpen ? "selected" : ""}`}
          type="button"
          aria-label={
            props.rightPanelOpen ? "Hide workbench" : "Show workbench"
          }
          aria-pressed={props.rightPanelOpen}
          onClick={props.onToggleRightPanel}
        >
          <PanelRight />
        </button>
      </div>
    </header>
  );
}

const workbenchTabs = [
  {
    id: "changes",
    label: "Changes",
    description: "Agent file changes will appear here.",
  },
  {
    id: "files",
    label: "Files",
    description: "The workspace file explorer is not connected yet.",
  },
  {
    id: "terminal",
    label: "Terminal",
    description: "Terminal sessions will open in this pane.",
  },
  {
    id: "trace",
    label: "Trace",
    description: "Run events and model calls will appear here.",
  },
  {
    id: "eval",
    label: "Eval",
    description: "Run evaluation will be added in a later phase.",
  },
] as const;

type WorkbenchTab = (typeof workbenchTabs)[number]["id"];

export function WorkbenchPanel(props: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>("files");
  const active = workbenchTabs.find((tab) => tab.id === activeTab)!;

  return (
    <aside className="workbench-panel" aria-label="Workbench">
      <header className="workbench-tabs" role="tablist">
        <div className="workbench-tab-scroll">
          {workbenchTabs.map((tab) => (
            <button
              className={`workbench-tab ${
                activeTab === tab.id ? "active" : ""
              }`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <button className="icon-button" type="button" disabled aria-label="New">
          <Plus />
        </button>
        <button
          className="icon-button close-workbench"
          type="button"
          aria-label="Hide workbench"
          onClick={props.onClose}
        >
          <ChevronsRight />
        </button>
      </header>
      <div className="workbench-body" role="tabpanel">
        <div className="workbench-empty">
          <span className="empty-pane-mark">{active.label.slice(0, 1)}</span>
          <strong>{active.label}</strong>
          <p>{active.description}</p>
        </div>
      </div>
    </aside>
  );
}
