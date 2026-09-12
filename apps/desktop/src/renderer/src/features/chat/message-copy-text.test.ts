import { describe, expect, it } from "vitest";

import {
  resolveAssistantMessageCopyText,
  resolveUserMessageCopyText,
} from "./message-copy-text";

describe("message-copy-text", () => {
  it("joins user text and attachment names", () => {
    expect(
      resolveUserMessageCopyText({
        text: "  hello  ",
        attachments: [{ relativePath: "a.png", name: "a.png", mediaType: "image/png" }],
      }),
    ).toBe("hello\n\n[附件: a.png]");
  });

  it("includes assistant thinking when requested", () => {
    expect(
      resolveAssistantMessageCopyText(
        { thinking: "plan", text: "# Answer" },
        { includeThinking: true },
      ),
    ).toBe("plan\n\n# Answer");
  });
});
