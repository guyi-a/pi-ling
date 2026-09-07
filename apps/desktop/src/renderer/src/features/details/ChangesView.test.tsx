import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ChangedFile, FileDiff } from "@pi-ling/contracts";
import { ChangesView } from "./ChangesView";

const file = (overrides: Partial<ChangedFile>): ChangedFile => ({
  path: "src/a.ts",
  status: "modified",
  binary: false,
  sensitive: false,
  tooLarge: false,
  additions: 3,
  deletions: 1,
  ...overrides,
});

describe("ChangesView", () => {
  it("renders an empty state when no files", () => {
    const html = renderToStaticMarkup(
      <ChangesView
        source="uncommitted"
        files={[]}
        getDiff={() => Promise.resolve(undefined)}
        onSourceChange={() => {}}
      />,
    );
    expect(html).toContain("当前来源没有可展示的文件变更");
  });

  it("renders file stat and path", () => {
    const html = renderToStaticMarkup(
      <ChangesView
        source="uncommitted"
        files={[file({})]}
        getDiff={() => Promise.resolve(undefined)}
        onSourceChange={() => {}}
      />,
    );
    expect(html).toContain("src/a.ts");
    expect(html).toContain("+3");
    expect(html).toContain("-1");
  });

  it("renders sensitive empty text", () => {
    const html = renderToStaticMarkup(
      <ChangesView
        source="uncommitted"
        files={[file({ sensitive: true })]}
        getDiff={() => Promise.resolve(undefined)}
        onSourceChange={() => {}}
      />,
    );
    expect(html).toContain("敏感文件只展示变更状态");
  });

  it("renders binary empty text", () => {
    const html = renderToStaticMarkup(
      <ChangesView
        source="uncommitted"
        files={[file({ binary: true })]}
        getDiff={() => Promise.resolve(undefined)}
        onSourceChange={() => {}}
      />,
    );
    expect(html).toContain("二进制文件不提供行级 Diff");
  });

  it("renders too-large empty text", () => {
    const html = renderToStaticMarkup(
      <ChangesView
        source="uncommitted"
        files={[file({ tooLarge: true })]}
        getDiff={() => Promise.resolve(undefined)}
        onSourceChange={() => {}}
      />,
    );
    expect(html).toContain("文件过大，已跳过行级 Diff");
  });
});
