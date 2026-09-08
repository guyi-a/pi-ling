import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ChangedFile } from "@pi-ling/contracts";

import { TurnChangesCard } from "./TurnChangesCard";

const file = (overrides: Partial<ChangedFile>): ChangedFile => ({
  path: "src/App.tsx",
  status: "modified",
  binary: false,
  sensitive: false,
  tooLarge: false,
  additions: 3,
  deletions: 1,
  ...overrides,
});

describe("TurnChangesCard", () => {
  it("renders file count and review action", () => {
    const html = renderToStaticMarkup(
      <TurnChangesCard
        files={[file({}), file({ path: "src/main.ts", additions: 2 })]}
        onReview={() => {}}
      />,
    );
    expect(html).toContain("2 Files Changed");
    expect(html).toContain("Review");
    expect(html).toContain("App.tsx");
    expect(html).toContain("+3");
    expect(html).toContain("-1");
  });

  it("returns null for empty files", () => {
    expect(TurnChangesCard({ files: [], onReview: () => {} })).toBeNull();
  });
});
