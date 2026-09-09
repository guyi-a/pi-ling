import { describe, expect, it } from "vitest";

import { isLongUserPromptText } from "./user-turn-prompt";

describe("isLongUserPromptText", () => {
  it("treats short single-line prompts as not long", () => {
    expect(isLongUserPromptText("帮我写一个 README")).toBe(false);
  });

  it("treats long text as long", () => {
    expect(isLongUserPromptText("a".repeat(121))).toBe(true);
  });

  it("treats multi-line prompts as long", () => {
    expect(isLongUserPromptText("line1\nline2\nline3\nline4")).toBe(true);
  });
});
