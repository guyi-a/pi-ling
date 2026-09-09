import { describe, expect, it } from "vitest";

import { catalogStats, loadCatalog, validateCatalog } from "../src/manifest.js";

describe("manifest", () => {
  it("loads the default smoke catalog", () => {
    const catalog = loadCatalog();
    validateCatalog(catalog);
    const stats = catalogStats(catalog);
    expect(stats.total).toBe(14);
    expect(stats.baseline).toBe(14);
    expect(stats.judged).toBe(2);
  });
});
