import { describe, expect, it } from "vitest";

import { runtimeMessagesToCompactionRows } from "./session-compaction.js";

describe("runtimeMessagesToCompactionRows", () => {
  it("accepts user messages with string content", () => {
    const rows = runtimeMessagesToCompactionRows([
      {
        role: "user",
        content: "hello",
        timestamp: 1,
      },
    ]);
    expect(rows).toEqual([
      { id: "user:0", order: 0, role: "user", content: "hello" },
    ]);
  });
});
