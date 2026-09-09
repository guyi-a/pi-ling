import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EvalCatalogTab } from "./EvalCatalogTab";
import { EvalCompareTab } from "./EvalCompareTab";
import { EvalResultsTab } from "./EvalResultsTab";
import { EvalToolbar } from "./EvalToolbar";

describe("Eval workbench", () => {
  it("renders toolbar and tab shells", () => {
    const toolbar = renderToStaticMarkup(
      <EvalToolbar
        running={false}
        progressText={null}
        onRun={() => {}}
        onCancel={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(toolbar).toContain("Run Suite");
    expect(toolbar).toContain("Reference");

    const catalog = renderToStaticMarkup(
      <EvalCatalogTab
        tasks={[
          {
            id: "smoke-fix-typo",
            title: "Fix typo",
            description: "Fix",
            enabled: true,
            baselineIncluded: true,
            hasJudge: false,
            promptPreview: "Fix the typo",
            hasLocalOverride: false,
          },
        ]}
        statsText="1 tasks · 1 baseline · 0 judged"
        taskDetail={null}
        selectedTaskId={null}
        running={false}
        onSelectTask={() => {}}
        onRunTask={() => {}}
        onSaveOverride={() => {}}
        onClearOverride={() => {}}
        onOpenCatalog={() => {}}
      />,
    );
    expect(catalog).toContain("smoke-fix-typo");

    const results = renderToStaticMarkup(
      <EvalResultsTab
        runs={[]}
        selectedRunKey={null}
        selectedRun={undefined}
        results={[]}
        running={false}
        onSelectRun={() => {}}
        onRunReference={() => {}}
      />,
    );
    expect(results).toContain("Run Reference Suite");

    const compare = renderToStaticMarkup(
      <EvalCompareTab
        runs={[
          {
            experiment: "eval-panel",
            variant: "a",
            driver: "reference",
            startedAt: "2026-01-01T00:00:00.000Z",
            finishedAt: "2026-01-01T00:00:01.000Z",
            total: 1,
            passed: 1,
            failed: 0,
            skipped: 0,
            errors: 0,
          },
        ]}
        compareRequest={null}
        compareView={null}
        onCompare={() => {}}
      />,
    );
    expect(compare).toContain("Run at least two suites");
  });
});
