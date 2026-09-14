import { describe, expect, it } from "vitest";

import { shouldMirrorScroll } from "./MergeDiffView";

describe("shouldMirrorScroll", () => {
  it("mirrors when the vertical positions differ", () => {
    expect(
      shouldMirrorScroll({ scrollTop: 300, scrollLeft: 0 }, { scrollTop: 0, scrollLeft: 0 }),
    ).toBe(true);
  });

  it("mirrors when only the horizontal positions differ", () => {
    expect(
      shouldMirrorScroll({ scrollTop: 0, scrollLeft: 120 }, { scrollTop: 0, scrollLeft: 0 }),
    ).toBe(true);
  });

  it("stays put when both panes already agree", () => {
    // 这是回声防抖的核心：赋值触发的 scroll 事件不会再反向传播
    expect(
      shouldMirrorScroll({ scrollTop: 240, scrollLeft: 0 }, { scrollTop: 240, scrollLeft: 0 }),
    ).toBe(false);
  });

  it("tolerates sub-pixel jitter from high-DPI scroll values", () => {
    expect(
      shouldMirrorScroll(
        { scrollTop: 100.4, scrollLeft: 0 },
        { scrollTop: 99.6, scrollLeft: 0 },
      ),
    ).toBe(false);
  });
});
