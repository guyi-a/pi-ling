import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AssistantMessageEventStream,
  createAssistantMessage,
  type Model,
  type ToolCall,
} from "@pi-ling/ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CodingAgent,
  type CodingAgentEvent,
  deriveEffect,
  effectDigest,
  Workspace,
} from "../src/index.js";

const model: Model = {
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
