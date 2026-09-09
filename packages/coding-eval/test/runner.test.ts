import { describe, expect, it } from "vitest";

import { findTask, loadCatalog } from "../src/manifest.js";
import { runTask } from "../src/runner.js";

describe("runner", () => {
  it("passes smoke-fix-typo with the reference driver", async () => {
    const catalog = loadCatalog();
    const task = findTask(catalog, "smoke-fix-typo");
    expect(task).toBeDefined();
    const result = await runTask(task!, {
      ledgerPath: "",
      driver: "reference-command",
    });
    expect(result.status).toBe("passed");
    expect(result.verification.every((item) => item.exit_code === 0)).toBe(true);
    expect(result.score.passed).toBe(true);
  });

  it("fails smoke-fix-typo with the noop driver", async () => {
    const catalog = loadCatalog();
    const task = findTask(catalog, "smoke-fix-typo");
    expect(task).toBeDefined();
    const result = await runTask(task!, {
      ledgerPath: "",
      skipAction: true,
      driver: "noop",
    });
    expect(result.status).toBe("failed");
  });
});
