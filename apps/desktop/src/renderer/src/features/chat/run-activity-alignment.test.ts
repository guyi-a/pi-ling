import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * run activity 的**对齐契约**。
 *
 * 摘要行与状态行的文字必须左对齐（用户明确要求「Planning 的 P 和上面 Ran 的 R
 * 在同一竖线」）。两行都靠 `padding-left: 1px` + `gap: 6px` 定位，因此左侧图标
 * 槽位的**总占位宽度必须相同**：
 *
 *   摘要行：箭头 13px
 *   状态行：转圈 11px + 左右各 1px margin = 13px（占位相同，但图标更小）
 *
 * 槽位宽度一旦改得不一致，两行文字就会错位，但功能测试发现不了，
 * 因此在这里显式锁定。
 */
const TIMELINE_CSS = readFileSync(
  fileURLToPath(new URL("../../styles/timeline.css", import.meta.url)),
  "utf8",
);

function ruleFor(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "s").exec(TIMELINE_CSS);
  return match?.[1] ?? "";
}

describe("run activity status row alignment", () => {
  it("keeps the summary chevron at 13px", () => {
    const rule = ruleFor(".run-activity-chevron");
    expect(rule).toMatch(/width:\s*13px/);
    expect(rule).toMatch(/height:\s*13px/);
  });

  it("makes the spinner visually smaller than the chevron", () => {
    const rule = ruleFor(".run-activity-status");
    expect(rule).toMatch(/width:\s*11px/);
    expect(rule).toMatch(/height:\s*11px/);
  });

  it("pads the spinner back to a 13px slot so the text lines up", () => {
    const rule = ruleFor(".run-activity-status");
    // 11px + 1px + 1px = 13px，与箭头等宽
    expect(rule).toMatch(/margin:\s*0\s+1px/);
  });

  it("gives the idle placeholder the same 13px slot", () => {
    const rule = ruleFor(".run-activity-status-spacer");
    expect(rule).toMatch(/width:\s*11px/);
    expect(rule).toMatch(/margin:\s*0\s+1px/);
  });

  it("uses the same padding and gap on both rows", () => {
    for (const selector of [".run-activity-summary", ".run-activity-live-slot"]) {
      const rule = ruleFor(selector);
      expect(rule, selector).toMatch(/padding:\s*3px\s+5px\s+3px\s+1px/);
      expect(rule, selector).toMatch(/gap:\s*6px/);
    }
  });

  it("no longer renders the redundant leading spacer element", () => {
    const markdownSource = readFileSync(
      fileURLToPath(new URL("./RunActivityBlock.tsx", import.meta.url)),
      "utf8",
    );
    expect(markdownSource).not.toContain("run-activity-leading-spacer");
    expect(TIMELINE_CSS).not.toContain("run-activity-leading-spacer");
  });
});
