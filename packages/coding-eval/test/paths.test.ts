import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { resolveRepoRoot } from "../src/paths.js";

describe("paths", () => {
  it("resolveRepoRoot points at the monorepo root", () => {
    const root = resolveRepoRoot();
    expect(existsSync(join(root, "apps", "desktop", "package.json"))).toBe(true);
    expect(
      existsSync(
        join(root, "apps", "desktop", "src", "main", "dsh-pi-ai-profile.ts"),
      ),
    ).toBe(true);
  });
});
