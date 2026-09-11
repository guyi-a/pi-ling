import { describe, expect, it } from "vitest";

import {
  codexToolInput,
  codexToolTitle,
  normalizeCodexCommandTool,
} from "../src/codex-tool-mapping.js";

describe("normalizeCodexCommandTool", () => {
  it("maps Add-Content to write_file with path", () => {
    expect(
      normalizeCodexCommandTool(
        'powershell -Command "Add-Content -LiteralPath a.md -Value world"',
      ),
    ).toEqual({ title: "write_file", path: "a.md" });
  });

  it("maps apply_patch update to edit_file", () => {
    expect(
      normalizeCodexCommandTool(
        'apply_patch "*** Begin Patch\\n*** Update File: a.md\\n+world\\n*** End Patch"',
      ),
    ).toEqual({ title: "edit_file", path: "a.md" });
  });

  it("leaves read-only shell commands unmapped", () => {
    expect(
      normalizeCodexCommandTool(
        'powershell -Command "Get-Content -LiteralPath a.md -Raw"',
      ),
    ).toBeUndefined();
  });
});

describe("codexToolTitle", () => {
  it("uses normalized title for commandExecution", () => {
    expect(
      codexToolTitle({
        id: "1",
        type: "commandExecution",
        command: "Add-Content -LiteralPath README.md -Value hi",
        aggregatedOutput: "",
        status: "completed",
      }),
    ).toBe("write_file");
  });

  it("includes normalized path in tool input", () => {
    expect(
      codexToolInput({
        id: "1",
        type: "commandExecution",
        command: "Add-Content -LiteralPath README.md -Value hi",
        aggregatedOutput: "",
        status: "completed",
      }),
    ).toEqual({
      command: "Add-Content -LiteralPath README.md -Value hi",
      path: "README.md",
    });
  });
});
