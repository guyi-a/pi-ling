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

    await agent.prompt("Create hello.txt");

    expect(await fs.readFile(path.join(root, "hello.txt"), "utf8")).toBe(
      "hello\n",
    );
    expect(observed.some((event) => event.type === "approval_requested")).toBe(
      true,
    );
    expect(await agent.changedFiles()).toEqual([
      expect.objectContaining({ path: "hello.txt", status: "added" }),
    ]);
    expect((await agent.diff("hello.txt"))?.patch).toContain("+hello");
  });
});
