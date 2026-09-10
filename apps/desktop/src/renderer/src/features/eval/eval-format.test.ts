import { describe, expect, it } from "vitest";

import {
  formatDuration,
  formatPassRate,
  runLabel,
  statusClass,
  statusLabel,
} from "./eval-format";

describe("eval-format", () => {
  it("formats duration and pass rate", () => {
    expect(formatDuration(450)).toBe("450ms");
    expect(formatDuration(1500)).toBe("1.5s");
    expect(formatPassRate(0.875)).toBe("87.5%");
  });

  it("maps status labels and classes", () => {
    expect(statusLabel("passed")).toBe("通过");
    expect(statusClass("failed")).toBe("is-failed");
    expect(statusLabel("missing")).toBe("缺失");
  });

  it("formats run labels", () => {
    expect(
      runLabel({
        variant: "ref-1",
        driver: "reference",
        passed: 10,
        total: 11,
      }),
    ).toBe("ref-1 (reference) · 10/11");
  });
});
