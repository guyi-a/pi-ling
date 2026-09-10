import type {
  RuntimeKind,
  WorkspaceListEntry,
} from "@pi-ling/contracts";
import {
  FolderPlus,
  ListFilter,
  MessageSquarePlus,
  PanelLeftClose,
  Settings,
} from "lucide-react";
import { memo, useEffect, useMemo, useState } from "react";

import { ProjectGroup } from "./ProjectGroup";

const COLLAPSED_PROJECTS_KEY = "pi-ling.sidebar.collapsed-projects";

function readCollapsedProjects(): Set<string> {
  try {
    const stored = JSON.parse(
      localStorage.getItem(COLLAPSED_PROJECTS_KEY) ?? "[]",
    ) as unknown;
    return new Set(
      Array.isArray(stored)
        ? stored.filter((value): value is string => typeof value === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

export const Sidebar = memo(function Sidebar(props: {
  workspaces: WorkspaceListEntry[];
  activeSessionId?: string;
  availableRuntimes: RuntimeKind[];
  onCollapse: () => void;
  onNewSession: (workspaceId?: string) => void;
  onAddWorkspace: () => void;
  onSelect: (sessionId: string) => void;
  onPin: (sessionId: string, pinned: boolean) => void;
  onArchive: (sessionId: string) => void;
  onRestore: (sessionId: string) => void;
  onOpenSettings: () => void;
  settingsOpen?: boolean;
  initialArchived?: boolean;
}) {
  const [showArchived, setShowArchived] = useState(
    props.initialArchived ?? false,
  );
  const [collapsedProjects, setCollapsedProjects] = useState(
    readCollapsedProjects,
  );
  const activeWorkspaceId = useMemo(
    () =>
      props.workspaces.find((workspace) =>
        workspace.sessions.some(
          (session) => session.id === props.activeSessionId,
        ),
      )?.id,
    [props.activeSessionId, props.workspaces],
  );

  useEffect(() => {
    if (!activeWorkspaceId) return;
    setCollapsedProjects((current) => {
      if (!current.has(activeWorkspaceId)) return current;
      const next = new Set(current);
      next.delete(activeWorkspaceId);
      localStorage.setItem(
        COLLAPSED_PROJECTS_KEY,
        JSON.stringify([...next]),
      );
      return next;
    });
  }, [activeWorkspaceId]);

  const visibleWorkspaces = props.workspaces
    .map((workspace) => ({
      ...workspace,
      sessions: workspace.sessions.filter((session) =>
        showArchived ? Boolean(session.archivedAt) : !session.archivedAt,
      ),
    }))
    .filter(
      (workspace) =>
        !showArchived || workspace.sessions.length > 0,
    );

  function toggleProject(workspaceId: string) {
    setCollapsedProjects((current) => {
      const next = new Set(current);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      localStorage.setItem(
        COLLAPSED_PROJECTS_KEY,
        JSON.stringify([...next]),
      );
      return next;
    });
  }

  return (
    <aside className="sidebar">
      <header className="sidebar-top">
        <button
          type="button"
          title="Hide sidebar"
          aria-label="Hide sidebar"
          onClick={props.onCollapse}
        >
          <PanelLeftClose />
        </button>
      </header>
      <nav className="primary-navigation" aria-label="Primary">
        <button
          className="sidebar-command"
          type="button"
          onClick={() => props.onNewSession()}
        >
          <MessageSquarePlus />
          <span>New chat</span>
        </button>
      </nav>
      <div className="sidebar-section-header">
        <span>Repositories</span>
        <div className="repository-actions">
          <details className="repository-filter">
            <summary
              title="Filter repositories"
              aria-label="Filter repositories"
            >
              <ListFilter />
            </summary>
            <div className="repository-filter-menu">
              <button
                className={!showArchived ? "selected" : ""}
                type="button"
                onClick={() => setShowArchived(false)}
              >
                Active chats
              </button>
              <button
                className={showArchived ? "selected" : ""}
                type="button"
                onClick={() => setShowArchived(true)}
              >
                Archived chats
              </button>
            </div>
          </details>
          <button
            type="button"
            title="Add repository"
            aria-label="Add repository"
            onClick={props.onAddWorkspace}
          >
            <FolderPlus />
          </button>
        </div>
      </div>
      <div className="session-list">
        {visibleWorkspaces.length === 0 ? (
          <div className="sidebar-empty">
            <span>
              {showArchived ? "No archived chats" : "No repositories"}
            </span>
            {!showArchived ? (
              <button type="button" onClick={props.onAddWorkspace}>
                Open a folder
              </button>
            ) : null}
          </div>
        ) : (
          visibleWorkspaces.map((workspace) => (
            <ProjectGroup
              workspace={workspace}
              sessions={workspace.sessions}
              expanded={!collapsedProjects.has(workspace.id)}
              archived={showArchived}
              {...(props.activeSessionId
                ? { activeSessionId: props.activeSessionId }
                : {})}
              availableRuntimes={props.availableRuntimes}
              key={workspace.id}
              onToggle={() => toggleProject(workspace.id)}
              onNewSession={() => props.onNewSession(workspace.id)}
              onSelect={props.onSelect}
              onPin={props.onPin}
              onArchive={props.onArchive}
              onRestore={props.onRestore}
            />
          ))
        )}
      </div>
      <button
        className={`sidebar-footer ${props.settingsOpen ? "active" : ""}`}
        type="button"
        aria-label="Open settings"
        aria-pressed={props.settingsOpen}
        onClick={props.onOpenSettings}
      >
        <span className="sidebar-avatar">π</span>
        <span className="sidebar-product">pi-ling</span>
        <Settings />
      </button>
    </aside>
  );
});
