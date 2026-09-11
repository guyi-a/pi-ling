import { describe, expect, it } from "vitest";

import {
  buildDshRuntimeOptions,
  dshEvalAvailable,
  resolveDshNodeCommand,
} from "../src/agent-drivers/dsh-env.js";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("DshAgentDriver", () => {
  it("reports whether DSH eval prerequisites are available", () => {
    expect(typeof dshEvalAvailable()).toBe("boolean");
  });

  it("loads DSH profile patch from the monorepo root", () => {
    const options = buildDshRuntimeOptions(join(tmpdir(), "dsh-eval-test-home"));
    expect(options.profilePatch?.trim().length).toBeGreaterThan(0);
  });

  it("uses node on PATH when running under Electron", () => {
    const original = process.versions.electron;
    try {
      Object.defineProperty(process.versions, "electron", {
        configurable: true,
        value: "39.0.0",
      });
      expect(resolveDshNodeCommand({})).toBe(process.execPath);
      expect(
        resolveDshNodeCommand({ PI_LING_NODE_BIN: "C:\\\\node\\\\node.exe" }),
      ).toBe("C:\\\\node\\\\node.exe");
    } finally {
      Object.defineProperty(process.versions, "electron", {
        configurable: true,
        value: original,
      });
    }
  });
});
