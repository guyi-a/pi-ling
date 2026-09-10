import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { maybeSpillToolOutput } from "../src/tools/spill-output.js";

describe("maybeSpillToolOutput", () => {
  it("writes oversized output to a workspace spill file", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "pi-ling-spill-"));
    const text = "line\n".repeat(5_000);
    const result = await maybeSpillToolOutput({
      sessionId: "session-1",
      callId: "call-1",
      workspaceRoot,
      text,
    });
    expect(result.spill?.path).toBe(".pi-ling/spills/session-1/call-1.txt");
    expect(result.text).toContain("read_file");
    expect(result.text).not.toBe(text);
    const spilled = await readFile(
      join(workspaceRoot, ".pi-ling/spills/session-1/call-1.txt"),
      "utf8",
    );
    expect(spilled).toBe(text);
  });
});
