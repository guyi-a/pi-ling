import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  type AssistantMessage,
  type Api,
  type Model,
  type ToolCall,
} from "@earendil-works/pi-ai";
import { AssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CodingAgent,
  type CodingAgentEvent,
  deriveEffect,
  effectDigest,
  Workspace,
} from "../src/index.js";

const model: Model<Api> = {
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  provider: "deepseek",
  baseUrl: "https://example.test",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

function createAssistantMessage(value: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: value.api,
    provider: value.provider,
    model: value.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

function responseWithTool(call: ToolCall): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const message = createAssistantMessage(model);
  message.content.push(call);
  message.stopReason = "toolUse";
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "toolUse", message });
  });
  return stream;
}

function responseWithText(text: string): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const message = createAssistantMessage(model);
  message.content.push({ type: "text", text });
  message.stopReason = "stop";
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: text,
      partial: message,
    });
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
}

describe("CodingAgent", () => {
  let root = "";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-coding-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("returns effect derivation failures to the model without ending the run", async () => {
    const responses = [
      responseWithTool({
        type: "toolCall",
        id: "absolute-list",
        name: "list_files",
        arguments: { path: path.join(root, "src") },
      }),
      responseWithText("I will use a relative path instead."),
    ];
    const observed: CodingAgentEvent[] = [];
    const agent = await CodingAgent.create({
      workspaceRoot: root,
      model,
      streamFn: () => responses.shift()!,
      emit: (event) => {
        observed.push(event);
      },
    });

    await expect(agent.prompt("inspect src", "path-error-run")).resolves.toBeUndefined();

    const failed = observed.find(
      (event) =>
        event.type === "agent" &&
        event.event.type === "tool_execution_end" &&
        event.event.toolCall.id === "absolute-list",
    );
    expect(failed).toMatchObject({
      type: "agent",
      event: {
        type: "tool_execution_end",
        result: {
          isError: true,
          content: [{ text: "Absolute paths are not allowed" }],
        },
      },
    });
    expect(
      agent.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content.some(
            (block) =>
              block.type === "text" &&
              block.text === "I will use a relative path instead.",
          ),
      ),
    ).toBe(true);
  });

  it("does not emit changes after read-only tools", async () => {
    await fs.writeFile(path.join(root, "existing.md"), "hello\n", "utf8");
    const responses = [
      responseWithTool({
        type: "toolCall",
        id: "glob-1",
        name: "glob",
        arguments: { glob_pattern: "*.md", target_directory: "." },
      }),
      responseWithText("Found markdown files."),
    ];
    const observed: CodingAgentEvent[] = [];
    const agent = await CodingAgent.create({
      workspaceRoot: root,
      model,
      approvalMode: "accept-write",
      streamFn: () => responses.shift()!,
      emit: (event) => {
        observed.push(event);
      },
    });

    await agent.prompt("List markdown files", "glob-run");

    expect(
      observed.some((event) => event.type === "changes"),
    ).toBe(false);
  });

  it("does not replay session changes after a later read-only tool", async () => {
    const responses = [
      responseWithTool({
        type: "toolCall",
        id: "write-1",
        name: "write_file",
        arguments: { path: "hello.txt", content: "hello\n" },
      }),
      responseWithText("Written."),
      responseWithTool({
        type: "toolCall",
        id: "glob-1",
        name: "glob",
        arguments: { glob_pattern: "*.txt", target_directory: "." },
      }),
      responseWithText("Listed."),
    ];
    const observed: CodingAgentEvent[] = [];
    const agent = await CodingAgent.create({
      workspaceRoot: root,
      model,
      approvalMode: "accept-write",
      streamFn: () => responses.shift()!,
      emit: (event) => {
        observed.push(event);
      },
    });

    await agent.prompt("Create hello.txt", "write-run");
    await agent.prompt("List text files", "glob-run");

    const changesEvents = observed.filter(
      (event): event is Extract<CodingAgentEvent, { type: "changes" }> =>
        event.type === "changes",
    );
    expect(changesEvents).toHaveLength(1);
    expect(changesEvents[0]?.runId).toBe("write-run");
    expect(changesEvents[0]?.callId).toBe("write-1");
  });

  it("pauses a write for approval, executes it, and continues", async () => {
    const responses = [
      responseWithTool({
        type: "toolCall",
        id: "write-1",
        name: "write_file",
        arguments: { path: "hello.txt", content: "hello\n" },
      }),
      responseWithText("Done."),
    ];
    const observed: CodingAgentEvent[] = [];
    let agent: CodingAgent;
    agent = await CodingAgent.create({
      workspaceRoot: root,
      model,
      streamFn: () => responses.shift()!,
      emit: (event) => {
        observed.push(event);
        if (event.type === "approval_requested") {
          queueMicrotask(() => {
            agent.resolveApproval(event.approval.callId, {
              approved: true,
              effectDigest: event.approval.effectDigest,
            });
          });
        }
      },
    });

    await agent.prompt("Create hello.txt", "run-write");

    expect(await fs.readFile(path.join(root, "hello.txt"), "utf8")).toBe(
      "hello\n",
    );
    expect(observed.some((event) => event.type === "approval_requested")).toBe(
      true,
    );
    const approvalIndex = observed.findIndex(
      (event) => event.type === "approval_requested",
    );
    const toolStartIndex = observed.findIndex(
      (event) =>
        event.type === "agent" &&
        event.event.type === "tool_execution_start",
    );
    const toolEndIndex = observed.findIndex(
      (event) =>
        event.type === "agent" &&
        event.event.type === "tool_execution_end",
    );
    const changesIndex = observed.findIndex(
      (event) => event.type === "changes",
    );
    expect(approvalIndex).toBeLessThan(toolStartIndex);
    expect(toolStartIndex).toBeLessThan(toolEndIndex);
    expect(toolEndIndex).toBeLessThan(changesIndex);
    expect(
      observed.every(
        (event) =>
          event.type === "agent" ||
          !("runId" in event) ||
          event.runId === "run-write",
      ),
    ).toBe(true);
    expect(await agent.changedFiles()).toEqual([
      expect.objectContaining({ path: "hello.txt", status: "added" }),
    ]);
    expect((await agent.diff("hello.txt"))?.patch).toContain("+hello");
  });

  it("allows workspace writes without a prompt in accept-write mode", async () => {
    const responses = [
      responseWithTool({
        type: "toolCall",
        id: "accepted-write",
        name: "write_file",
        arguments: { path: "accepted.txt", content: "accepted\n" },
      }),
      responseWithText("Done."),
    ];
    let approvals = 0;
    const agent = await CodingAgent.create({
      workspaceRoot: root,
      model,
      approvalMode: "accept-write",
      streamFn: () => responses.shift()!,
      emit: (event) => {
        if (event.type === "approval_requested") approvals += 1;
      },
    });

    await agent.prompt("Create accepted.txt", "accept-write-run");

    expect(approvals).toBe(0);
    expect(await fs.readFile(path.join(root, "accepted.txt"), "utf8")).toBe(
      "accepted\n",
    );
  });

  it("resumes an approved pending tool exactly once", async () => {
    const call: ToolCall = {
      type: "toolCall",
      id: "resume-write",
      name: "write_file",
      arguments: { path: "resumed.txt", content: "resumed\n" },
    };
    const assistant = createAssistantMessage(model);
    assistant.stopReason = "toolUse";
    assistant.content.push(call);
    const workspace = await Workspace.open(root);
    const effect = await deriveEffect(call, workspace);
    const approval = {
      runId: "resume-run",
      turnId: "resume-run:turn:1",
      callId: call.id,
      tool: call.name,
      arguments: call.arguments,
      effect,
      effectDigest: effectDigest(effect, call),
      reason: "write",
    };
    let approvalEvents = 0;
    const agent = await CodingAgent.create({
      workspaceRoot: root,
      model,
      messages: [assistant],
      approvedApprovals: [approval],
      streamFn: () => responseWithText("resumed"),
      emit: (event) => {
        if (event.type === "approval_requested") {
          approvalEvents += 1;
        }
      },
    });

    await agent.resumePendingTools({
      runId: "resume-run",
      turnId: "resume-run:turn:1",
      turn: 1,
    });

    expect(approvalEvents).toBe(0);
    expect(await fs.readFile(path.join(root, "resumed.txt"), "utf8")).toBe(
      "resumed\n",
    );
    expect(
      agent.messages.filter(
        (message) =>
          message.role === "toolResult" &&
          message.toolCallId === "resume-write",
      ),
    ).toHaveLength(1);
  });

  it("rebuilds a pending approval wait without emitting a duplicate request", async () => {
    const call: ToolCall = {
      type: "toolCall",
      id: "pending-write",
      name: "write_file",
      arguments: { path: "pending.txt", content: "approved\n" },
    };
    const assistant = createAssistantMessage(model);
    assistant.stopReason = "toolUse";
    assistant.content.push(call);
    const workspace = await Workspace.open(root);
    const effect = await deriveEffect(call, workspace);
    const approval = {
      runId: "pending-run",
      turnId: "pending-run:turn:1",
      callId: call.id,
      tool: call.name,
      arguments: call.arguments,
      effect,
      effectDigest: effectDigest(effect, call),
      reason: "write",
    };
    let duplicateRequests = 0;
    const agent = await CodingAgent.create({
      workspaceRoot: root,
      model,
      messages: [assistant],
      pendingApprovals: [approval],
      streamFn: () => responseWithText("continued"),
      emit: (event) => {
        if (event.type === "approval_requested") {
          duplicateRequests += 1;
        }
      },
    });

    const resumed = agent.resumePendingTools({
      runId: approval.runId,
      turnId: approval.turnId,
      turn: 1,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(agent.pendingApprovals()).toHaveLength(1);
    expect(
      await agent.resolveApproval(call.id, {
        approved: true,
        effectDigest: approval.effectDigest,
      }),
    ).toBe(true);
    await resumed;

    expect(duplicateRequests).toBe(0);
    expect(await fs.readFile(path.join(root, "pending.txt"), "utf8")).toBe(
      "approved\n",
    );
  });
});
