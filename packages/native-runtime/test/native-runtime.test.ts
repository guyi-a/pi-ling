import { describe, expect, it } from "vitest";

import { NativeRuntimeAdapter } from "../src/index.js";

describe("NativeRuntimeAdapter", () => {
  it("declares native runtime capabilities and lifecycle", async () => {
    const runtime = new NativeRuntimeAdapter();
    await runtime.initialize();
    expect(runtime.kind).toBe("native");
    expect(runtime.capabilities).toMatchObject({
      partialStreaming: true,
      toolApproval: true,
      resume: true,
    });
    await runtime.dispose();
  });
});
