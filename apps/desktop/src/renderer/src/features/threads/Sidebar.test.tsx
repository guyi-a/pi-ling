import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("renders active session lifecycle and workspace", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        workspaces={[
          {
            id: "workspace",
            root: "E:\\project",
            name: "project",
            createdAt: Date.now(),
            updatedAt: Date.now(),
            sessions: [
              {
                id: "session",
                workspaceId: "workspace",
                title: "实现登录",
                workspace: { root: "E:\\project", name: "project" },
                lifecycle: "awaiting_approval",
                approvalMode: "manual",
                runtimeKind: "native",
                createdAt: Date.now(),
                updatedAt: Date.now(),
              },
            ],
          },
        ]}
        activeSessionId="session"
        availableRuntimes={["native"]}
        onCollapse={() => {}}
        onNewSession={() => {}}
        onAddWorkspace={() => {}}
        onSelect={() => {}}
        onPin={() => {}}
        onArchive={() => {}}
        onRestore={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(html).toContain("session-item active");
    expect(html).toContain("project");
    expect(html).toContain("Archive chat");
    expect(html).toContain("Hide sidebar");
  });

  it("renders archived sessions with a restore action", () => {
    const now = Date.now();
    const html = renderToStaticMarkup(
      <Sidebar
        workspaces={[
          {
            id: "workspace",
            root: "E:\\project",
            name: "project",
            createdAt: now,
            updatedAt: now,
            sessions: [
              {
                id: "archived",
                workspaceId: "workspace",
                title: "Archived work",
                workspace: { root: "E:\\project", name: "project" },
                lifecycle: "idle",
                approvalMode: "manual",
                runtimeKind: "native",
                archivedAt: now,
                createdAt: now,
                updatedAt: now,
              },
            ],
          },
        ]}
        availableRuntimes={["native"]}
        initialArchived
        onCollapse={() => {}}
        onNewSession={() => {}}
        onAddWorkspace={() => {}}
        onSelect={() => {}}
        onPin={() => {}}
        onArchive={() => {}}
        onRestore={() => {}}
        onOpenSettings={() => {}}
      />,
    );
    expect(html).toContain("Archived work");
    expect(html).toContain("Restore chat");
  });
});
