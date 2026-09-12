import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { ToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ApprovalManager,
  type ApprovalRequest,
  type ApprovalMode,
  type Effect,
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

  it("allows glob and read_image while requiring delete approval", async () => {
    const glob = await deriveEffect(
      {
        type: "toolCall",
        id: "glob",
        name: "glob",
        arguments: { glob_pattern: "**/*.ts", target_directory: "." },
      },
      workspace,
    );
    const image = await deriveEffect(
      {
        type: "toolCall",
        id: "image",
        name: "read_image",
        arguments: { path: "photo.png" },
      },
      workspace,
    );
    const del = await deriveEffect(
      {
        type: "toolCall",
        id: "delete",
        name: "delete",
        arguments: { path: "photo.png" },
      },
      workspace,
    );
    expect(approvalReason(glob)).toBeUndefined();
    expect(approvalReason(image)).toBeUndefined();
    expect(approvalReason(del)).toContain("delete");
    expect(approvalReason(del, "accept-write")).toBeUndefined();
  });

  it("treats web tools as read-only but flags private-network fetches", async () => {
    const fetchCall = await deriveEffect(
      {
        type: "toolCall",
        id: "web",
        name: "web_fetch",
        arguments: { url: "https://docs.example.com/guide" },
      },
      workspace,
    );
    expect(fetchCall).toMatchObject({
      kind: "network",
      privateHost: false,
      target: "https://docs.example.com/guide",
    });
    expect(approvalReason(fetchCall)).toBeUndefined();

    const localCall = await deriveEffect(
      {
        type: "toolCall",
        id: "local",
        name: "web_fetch",
        arguments: { url: "http://127.0.0.1:8080/status" },
      },
      workspace,
    );
    expect(localCall).toMatchObject({ kind: "network", privateHost: true });
    expect(approvalReason(localCall)).toContain("private network");

    const searchCall = await deriveEffect(
      {
        type: "toolCall",
        id: "search",
        name: "web_search",
        arguments: { query: "electron vite" },
      },
      workspace,
    );
    expect(searchCall).toMatchObject({
      kind: "network",
      target: "electron vite",
      privateHost: false,
    });
    expect(approvalReason(searchCall)).toBeUndefined();
  });

  it("locks the product approval matrix across all modes", () => {
    const modes: ApprovalMode[] = ["manual", "accept-write", "auto"];
    const cases: Array<{
      name: string;
      effect: Effect;
      prompts: [boolean, boolean, boolean];
      call?: ToolCall;
    }> = [
      {
        name: "workspace read",
        effect: {
          kind: "filesystem-read",
          operation: "read",
          path: path.join(root, "README.md"),
          scope: "workspace",
        },
        prompts: [false, false, false],
      },
      {
        name: "workspace write",
        effect: {
          kind: "filesystem-write",
          operation: "write",
          path: path.join(root, "file.txt"),
          scope: "workspace",
        },
        prompts: [true, false, false],
      },
      {
        name: "harmless command",
        effect: {
          kind: "process-exec",
          command: "git status",
          cwd: root,
          classification: "harmless",
        },
        prompts: [false, false, false],
      },
      {
        name: "normal command",
        effect: {
          kind: "process-exec",
          command: "pnpm test",
          cwd: root,
          classification: "normal",
        },
        prompts: [true, true, false],
      },
      {
        name: "destructive command",
        effect: {
          kind: "process-exec",
          command: "git reset --hard",
          cwd: root,
          classification: "destructive",
        },
        prompts: [true, true, true],
      },
      {
        name: "sensitive write",
        effect: {
          kind: "filesystem-write",
          operation: "write",
          path: path.join(root, ".env"),
          scope: "workspace",
        },
        prompts: [true, true, true],
        call: {
          type: "toolCall",
          id: "sensitive",
          name: "write_file",
          arguments: { path: ".env", content: "API_KEY=secret" },
        },
      },
      {
        name: "unknown effect",
        effect: { kind: "unknown", note: "unknown tool" },
        prompts: [true, true, true],
      },
    ];

    for (const testCase of cases) {
      expect(
        modes.map(
          (mode) =>
            approvalReason(testCase.effect, mode, testCase.call) !== undefined,
        ),
        testCase.name,
      ).toEqual(testCase.prompts);
    }
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
