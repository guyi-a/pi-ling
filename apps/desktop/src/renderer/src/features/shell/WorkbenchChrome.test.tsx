import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AgentPaneToolbar,
  AppTitleBar,
  WorkbenchPanel,
} from "./WorkbenchChrome";

describe("workbench chrome", () => {
  it("renders application, agent and workbench chrome", () => {
    const html = renderToStaticMarkup(
      <>
        <AppTitleBar />
        <AgentPaneToolbar
          title="Review runtime changes"
          runtimeKind="native"
          sidebarCollapsed={false}
          rightPanelOpen
          onShowSidebar={() => {}}
          onToggleRightPanel={() => {}}
        />
        <WorkbenchPanel onClose={() => {}} />
      </>,
    );

    expect(html).toContain("Application menu");
    expect(html).toContain("Review runtime changes");
    expect(html).toContain('aria-label="Workbench"');
    expect(html).toContain("Changes");
    expect(html).toContain("Files");
    expect(html).toContain("Terminal");
    expect(html).toContain("Trace");
    expect(html).toContain("Eval");
  });

  it("renders ChangesView when changes props are provided", () => {
    const html = renderToStaticMarkup(
      <WorkbenchPanel
        initialTab="changes"
        onClose={() => {}}
        changesSource="uncommitted"
        changesFiles={[
          {
            path: "src/a.ts",
            status: "modified",
            binary: false,
            sensitive: false,
            tooLarge: false,
            additions: 3,
            deletions: 1,
          },
        ]}
        onChangeSource={() => {}}
        onLoadDiff={() => Promise.resolve(undefined)}
      />,
    );

    expect(html).toContain("Uncommitted");
    expect(html).toContain("src/a.ts");
    expect(html).toContain("changes-panel");
  });

  it("shows the sidebar restore control only when collapsed", () => {
    const html = renderToStaticMarkup(
      <AgentPaneToolbar
        title="Session"
        runtimeKind="native"
        sidebarCollapsed
        rightPanelOpen
        onShowSidebar={() => {}}
        onToggleRightPanel={() => {}}
      />,
    );
    expect(html).toContain("Show sidebar");
  });
});
