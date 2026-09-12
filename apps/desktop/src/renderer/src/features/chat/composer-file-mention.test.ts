import { describe, expect, it } from "vitest";

import {
  filterWorkspaceFilesForMention,
  insertMentionAtToken,
  parseActiveMentionToken,
} from "./composer-file-mention";

describe("composer-file-mention", () => {
  it("parses an active @ token before the cursor", () => {
    const text = "请读 @docs/py/12";
    expect(parseActiveMentionToken(text, text.length))?.toEqual({
      start: 3,
      end: text.length,
      query: "docs/py/12",
    });
  });

  it("returns null when @ is not active", () => {
    expect(parseActiveMentionToken("hello world", 5)).toBeNull();
  });

  it("inserts a mention and trailing space", () => {
    const text = "看 @doc";
    const token = parseActiveMentionToken(text, text.length);
    expect(token).not.toBeNull();
    const result = insertMentionAtToken(text, token!, "docs/py/123.jpg");
    expect(result.nextText).toBe("看 @docs/py/123.jpg ");
    expect(result.nextCursor).toBe(result.nextText.length);
  });

  it("filters workspace files by path or name", () => {
    const entries = [
      { name: "123.jpg", path: "docs/py/123.jpg", kind: "file" as const },
      { name: "readme.md", path: "readme.md", kind: "file" as const },
      { name: "src", path: "src/", kind: "dir" as const },
    ];
    expect(filterWorkspaceFilesForMention(entries, "123")).toEqual([
      entries[0],
    ]);
    expect(filterWorkspaceFilesForMention(entries, "")).toEqual([entries[0], entries[1]]);
  });
});
