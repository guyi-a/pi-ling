import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ApprovalManager,
  type ApprovalRequest,
  approvalReason,
  classifyCommand,
  deriveEffect,
  Workspace,
} from "../src/index.js";

describe("effects and approval", () => {
  let root = "";
  let workspace: Workspace;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-approval-"));
    workspace = await Workspace.open(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("classifies harmless, normal and destructive commands", () => {
    expect(classifyCommand("git status")).toBe("harmless");
    expect(classifyCommand("npm test")).toBe("normal");
    expect(classifyCommand("git reset --hard")).toBe("destructive");
    expect(
      approvalReason(
        {
          kind: "process-exec",
          command: "npm test",
          cwd: root,
          classification: "normal",
        },
        "auto",
      ),
    ).toBeUndefined();
    expect(
      approvalReason(
        {
          kind: "process-exec",
          command: "git reset --hard",
          cwd: root,
          classification: "destructive",
        },
        "auto",
      ),
    ).toBe("destructive command");
  });

  it("allows workspace reads and asks for writes", async () => {
    const read = await deriveEffect(
      {
        type: "toolCall",
        id: "read",
        name: "read_file",
        arguments: { path: "README.md" },
      },
      workspace,
    );
    const write = await deriveEffect(
      {
        type: "toolCall",
        id: "write",
        name: "write_file",
        arguments: { path: "README.md", content: "hello" },
      },
      workspace,
    );
    expect(approvalReason(read)).toBeUndefined();
    expect(approvalReason(write)).toContain("write");
    expect(approvalReason(write, "accept-write")).toBeUndefined();
    expect(approvalReason(write, "auto")).toBeUndefined();
    const sensitiveCall = {
      type: "toolCall" as const,
      id: "sensitive",
      name: "write_file",
      arguments: { path: ".env", content: "API_KEY=secret" },
    };
    expect(
      approvalReason(
        await deriveEffect(sensitiveCall, workspace),
        "auto",
        sensitiveCall,
      ),
    ).toBe("sensitive file");
  });

  it("binds decisions to the exact effect digest", async () => {
    let requested: ApprovalRequest | undefined;
    const approvals = new ApprovalManager((request) => {
      requested = request;
    });
    const call: ToolCall = {
      type: "toolCall",
      id: "call-1",
      name: "write_file",
      arguments: { path: "file.txt", content: "hello" },
    };
    const effect = await deriveEffect(call, workspace);
    const waiting = approvals.wait(
      call,
      effect,
      new AbortController().signal,
      { runId: "run-1", turnId: "run-1:turn:1" },
      "write",
    );

    expect(
      approvals.resolve(call.id, {
        approved: true,
        effectDigest: "wrong",
      }),
    ).toBe(false);
    expect(
      approvals.resolve(call.id, {
        approved: true,
        effectDigest: requested!.effectDigest,
      }),
    ).toBe(true);
    await expect(waiting).resolves.toEqual({ allow: true });
  });

  it("settles pending approvals when cancelled", async () => {
    const approvals = new ApprovalManager(() => {});
    const call: ToolCall = {
      type: "toolCall",
      id: "call-2",
      name: "run_command",
      arguments: { command: "npm test" },
    };
    const waiting = approvals.wait(
      call,
      await deriveEffect(call, workspace),
      new AbortController().signal,
      { runId: "run-2", turnId: "run-2:turn:1" },
      "command",
    );
    approvals.cancelAll("cancelled");
    await expect(waiting).resolves.toEqual({
      allow: false,
      reason: "cancelled",
    });
  });
});
