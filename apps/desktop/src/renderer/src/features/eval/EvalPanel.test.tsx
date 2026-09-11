import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { EvalCatalogTab } from "./EvalCatalogTab";
import { EvalCompareTab } from "./EvalCompareTab";
import { EvalEmptyState } from "./EvalEmptyState";
import { EvalPanel } from "./EvalPanel";
import { EvalResultsTab } from "./EvalResultsTab";
import { EvalRunControls } from "./EvalRunControls";

describe("Eval workbench", () => {
  it("hides panel when inactive", () => {
    const html = renderToStaticMarkup(<EvalPanel active={false} />);
    expect(html).toContain("is-hidden");
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders run controls and tab shells in Chinese", () => {
    const toolbar = renderToStaticMarkup(
      <EvalRunControls
        running={false}
        availableRuntimes={["native", "dsh"]}
        onRun={() => {}}
        onCancel={() => {}}
        onRefresh={() => {}}
      />,
    );
    expect(toolbar).toContain("运行套件");
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
        statsText="共 1 项 · 1 条基线 · 0 条已评判"
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
    expect(catalog).toContain("搜索任务 ID 或标题");

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
    expect(results).toContain("运行 Reference 套件");

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
    expect(compare).toContain("至少运行两次套件");
  });

  it("renders centered empty state", () => {
    const html = renderToStaticMarkup(
      <EvalEmptyState title="结果" description="还没有评测运行记录。" />,
    );
    expect(html).toContain("eval-empty");
    expect(html).toContain("结果");
  });
});
