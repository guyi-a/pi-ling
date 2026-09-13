import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 这两组规则是**隐式契约**：Streamdown 把代码断行和着色都交给 Tailwind
 * 工具类处理，而 pi-ling 没有 Tailwind。规则一旦被当成「无用样式」删掉，
 * 代码块会立刻退回「挤成一行 + 全灰」，但单元测试发现不了。
 * 因此在这里显式锁定。
 */
const CHAT_CSS = readFileSync(
  fileURLToPath(new URL("../../styles/chat.css", import.meta.url)),
  "utf8",
);

describe("code block CSS contract", () => {
  it("breaks each shiki line, since the markup has no newline characters", () => {
    expect(CHAT_CSS).toMatch(
      /\[data-streamdown="code-block-body"\]\s+code\s*>\s*span\s*\{[^}]*display:\s*block/s,
    );
  });

  it("consumes the token CSS variables for dark theme (pi-ling default)", () => {
    expect(CHAT_CSS).toMatch(
      /\[data-streamdown="code-block-body"\]\s+code\s*>\s*span\s*>\s*span\s*\{[^}]*color:\s*var\(--shiki-dark/s,
    );
  });

  it("falls back to the light-theme token color under data-theme=light", () => {
    expect(CHAT_CSS).toMatch(
      /html\[data-theme="light"\][^{]*\[data-streamdown="code-block-body"\][^{]*\{[^}]*color:\s*var\(--sdm-c/s,
    );
  });
});
