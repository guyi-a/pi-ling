import { describe, expect, it } from "vitest";

import { isMissingCodexRolloutError } from "../src/codex-rollout-errors.js";

describe("isMissingCodexRolloutError", () => {
  it("detects missing rollout errors", () => {
    expect(
      isMissingCodexRolloutError(
        new Error("no rollout found for thread id abc"),
      ),
    ).toBe(true);
  });

  it("ignores unrelated errors", () => {
    expect(isMissingCodexRolloutError(new Error("network timeout"))).toBe(
      false,
    );
  });
});
