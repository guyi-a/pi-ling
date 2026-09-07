import type { ApprovalMode } from "@pi-ling/contracts";
import { describe, expect, it } from "vitest";

import {
  evaluateDshApproval,
  type DshPermissionEffectInput,
} from "./dsh-approval-policy.js";

const modes: ApprovalMode[] = ["manual", "accept-write", "auto"];
const workspaceRoot = "/workspace";

function prompts(event: DshPermissionEffectInput): boolean[] {
  return modes.map(
    (mode) =>
      evaluateDshApproval(event, mode, workspaceRoot).reason !== undefined,
  );
}

describe("evaluateDshApproval", () => {
  it("matches the Native product approval matrix", () => {
    expect(
      prompts({
        callId: "read",
        title: "read",
        toolKind: "read",
        input: { file_path: "README.md" },
      }),
    ).toEqual([false, false, false]);
    expect(
      prompts({
        callId: "write",
        title: "write",
        toolKind: "edit",
        input: { file_path: "file.txt", content: "hello" },
      }),
    ).toEqual([true, false, false]);
    expect(
      prompts({
        callId: "harmless",
        title: "bash",
        toolKind: "execute",
        input: { command: "git status" },
      }),
    ).toEqual([false, false, false]);
    expect(
      prompts({
        callId: "normal",
        title: "bash",
        toolKind: "execute",
        input: { command: "pnpm test" },
      }),
    ).toEqual([true, true, false]);
    expect(
      prompts({
        callId: "destructive",
        title: "bash",
        toolKind: "execute",
        input: { command: "git reset --hard" },
      }),
    ).toEqual([true, true, true]);
    expect(
      prompts({
        callId: "sensitive",
        title: "write",
        toolKind: "edit",
        input: { file_path: ".env", content: "API_KEY=secret" },
      }),
    ).toEqual([true, true, true]);
    expect(
      prompts({
        callId: "unknown",
        title: "new-tool",
        toolKind: "other",
        input: {},
      }),
    ).toEqual([true, true, true]);
    expect(
      prompts({
        callId: "missing-command",
        title: "bash",
        toolKind: "execute",
        input: {},
      }),
    ).toEqual([true, true, true]);
  });

  it("fails closed for paths outside the workspace", () => {
    expect(
      prompts({
        callId: "outside",
        title: "write",
        toolKind: "edit",
        input: { file_path: "../outside.txt", content: "hello" },
      }),
    ).toEqual([true, true, true]);
  });
});
