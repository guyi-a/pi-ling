import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { UserTimelineItem } from "../../timeline/reducer";
import { UserTurnPrompt } from "./UserTurnPrompt";

function userItem(
  overrides: Partial<UserTimelineItem> = {},
): UserTimelineItem {
  return {
    id: "user-1",
    kind: "user",
    runId: "run-a",
    turnId: "turn-1",
    text: "帮我写一个 README",
    createdSeq: 1,
    ...overrides,
  };
}

describe("UserTurnPrompt", () => {
  it("renders user text in turn prompt header", () => {
    const html = renderToStaticMarkup(
      <UserTurnPrompt item={userItem()} />,
    );
    expect(html).toContain("user-turn-prompt");
    expect(html).toContain("message-copy-action");
    expect(html).toContain("帮我写一个 README");
  });

  it("returns null when there is no visible content", () => {
    const html = renderToStaticMarkup(
      <UserTurnPrompt item={userItem({ text: "   ", attachments: [] })} />,
    );
    expect(html).toBe("");
  });

  it("shows expand control for long prompts", () => {
    const html = renderToStaticMarkup(
      <UserTurnPrompt
        item={userItem({
          text: "line1\nline2\nline3\nline4",
        })}
      />,
    );
    expect(html).toContain("is-collapsible");
    expect(html).toContain("展开");
  });

  it("does not show expand control for short prompts", () => {
    const html = renderToStaticMarkup(<UserTurnPrompt item={userItem()} />);
    expect(html).not.toContain("user-turn-prompt-toggle");
  });
});
