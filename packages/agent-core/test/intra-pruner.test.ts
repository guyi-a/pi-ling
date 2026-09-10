import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { pruneContextToolResults } from "../src/intra-pruner.js";

function toolResult(id: string, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: "read_file",
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 1,
  };
}

describe("pruneContextToolResults", () => {
  it("truncates older tool results while keeping recent ones intact", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "go" }], timestamp: 1 },
      toolResult("1", "x".repeat(20_000)),
      toolResult("2", "y".repeat(20_000)),
      toolResult("3", "keep-me"),
    ] as const;

    const pruned = pruneContextToolResults([...messages], {
      keepRecentToolResults: 1,
      headChars: 100,
      tailChars: 100,
    });

    const first = pruned[1] as ToolResultMessage;
    const last = pruned[3] as ToolResultMessage;
    expect(first.content[0]?.type === "text" ? first.content[0].text : "").toContain(
      "pruned",
    );
    expect(last.content[0]?.type === "text" ? last.content[0].text : "").toBe(
      "keep-me",
    );
  });
});
