import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Sidebar } from "./Sidebar";

describe("Sidebar", () => {
  it("renders active session lifecycle and workspace", () => {
    const html = renderToStaticMarkup(
      <Sidebar
        sessions={[
          {
            id: "session",
            title: "实现登录",
            workspace: { root: "E:\\project", name: "project" },
            lifecycle: "awaiting_approval",
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        ]}
        activeSessionId="session"
        onNewSession={() => {}}
        onSelect={() => {}}
      />,
    );
    expect(html).toContain("session-item active");
    expect(html).toContain("session-status awaiting_approval");
    expect(html).toContain("project");
  });
});
