import { describe, expect, it } from "vitest";

import {
  DEFAULT_SESSION_TITLE,
  deriveSessionTitle,
  isPlaceholderSessionTitle,
} from "./session-title.js";

describe("session title helpers", () => {
  it("derives concise titles from user text", () => {
    expect(deriveSessionTitle("  hello\nworld  ")).toBe("hello world");
    expect(deriveSessionTitle("x".repeat(60))).toHaveLength(46);
  });

  it("recognizes placeholder titles", () => {
    expect(isPlaceholderSessionTitle(DEFAULT_SESSION_TITLE, "pi-ling")).toBe(
      true,
    );
    expect(isPlaceholderSessionTitle("pi-ling", "pi-ling")).toBe(true);
    expect(isPlaceholderSessionTitle("Fix bug", "pi-ling")).toBe(false);
  });
});
