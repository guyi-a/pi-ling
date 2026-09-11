import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

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

  it("creates a session from the pinned pi-ai DeepSeek catalog", async () => {
    const workspaceRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "pi-ling-native-pi-ai-"),
    );
    const runtime = new NativeRuntimeAdapter();
    try {
      await expect(
        runtime.createSession({
          sessionId: "native-pi-ai",
          workspaceRoot,
          provider: "deepseek",
          model: "deepseek-flash",
        }),
      ).resolves.toEqual({
        sessionId: "native-pi-ai",
        externalSessionId: "native-pi-ai",
      });
    } finally {
      await runtime.dispose();
      await fs.rm(workspaceRoot, { recursive: true, force: true });
    }
  });
});
