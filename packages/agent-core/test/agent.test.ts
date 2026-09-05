import {
  AssistantMessageEventStream,
  createAssistantMessage,
  Type,
  type Context,
  type Model,
  type StreamOptions,
  type ToolCall,
} from "@pi-ling/ai";
import { describe, expect, it } from "vitest";

import {
  Agent,
  type AgentEvent,
  type AgentTool,
  type StreamFunction,
} from "../src/index.js";

const model: Model = {
  id: "test-model",
  name: "Test Model",
  api: "openai-completions",
  provider: "deepseek",
  baseUrl: "https://example.test",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1000,
  maxTokens: 100,
};

function textResponse(text: string): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const message = createAssistantMessage(model);
  const block = { type: "text" as const, text };
  message.content.push(block);
  message.stopReason = "stop";
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({
      type: "text_start",
      contentIndex: 0,
      partial: message,
    });
    stream.push({
      type: "text_delta",
      contentIndex: 0,
      delta: text,
      partial: message,
    });
    stream.push({
      type: "text_end",
      contentIndex: 0,
      content: text,
      partial: message,
    });
    stream.push({ type: "done", reason: "stop", message });
  });
  return stream;
}

function toolResponse(call: ToolCall): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const message = createAssistantMessage(model);
  message.content.push(call);
  message.stopReason = "toolUse";
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({
      type: "toolcall_start",
      contentIndex: 0,
      partial: message,
    });
    stream.push({
      type: "toolcall_end",
      contentIndex: 0,
      toolCall: call,
      partial: message,
    });
    stream.push({ type: "done", reason: "toolUse", message });
  });
  return stream;
}

describe("Agent", () => {
  it("retains transcript context across prompts", async () => {
    const contexts: Context[] = [];
    const responses = [textResponse("first"), textResponse("second")];
    const streamFn: StreamFunction = (_model, context) => {
      contexts.push(structuredClone(context));
      return responses.shift()!;
    };
    const agent = new Agent({
      initialState: { model, thinkingLevel: "high" },
      streamFn,
    });

    await agent.prompt("one");
    await agent.prompt("two");

    expect(contexts[0]?.messages).toHaveLength(1);
    expect(contexts[1]?.messages).toHaveLength(3);
    expect(agent.state.messages).toHaveLength(4);
  });

  it("executes tool calls and feeds results into the next turn", async () => {
    const calls: unknown[] = [];
    const addParameters = Type.Object({
      left: Type.Number(),
      right: Type.Number(),
    });
    const addTool: AgentTool<typeof addParameters> = {
      name: "add",
      label: "Add",
      description: "Add two numbers",
      parameters: addParameters,
      execute: async (_id, arguments_) => {
        calls.push(arguments_);
        return {
          content: [
            {
              type: "text",
              text: String(arguments_.left + arguments_.right),
            },
          ],
        };
      },
    };
    const responses = [
      toolResponse({
        type: "toolCall",
        id: "call-1",
        name: "add",
        arguments: { left: 2, right: 3 },
      }),
      textResponse("5"),
    ];
    const streamFn: StreamFunction = () => responses.shift()!;
    const agent = new Agent({
      initialState: {
        model,
        tools: [addTool],
      },
      streamFn,
    });
    const events: AgentEvent[] = [];
    agent.subscribe((event) => {
      events.push(event);
    });

    await agent.prompt("add 2 and 3", { runId: "run-tools" });

    expect(calls).toEqual([{ left: 2, right: 3 }]);
    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain("tool_execution_start");
    expect(eventTypes).toContain("tool_execution_end");
    expect(events.every((event) => event.runId === "run-tools")).toBe(true);
    expect(
      events
        .filter((event) => event.type === "turn_start")
        .map((event) => event.turnId),
    ).toEqual(["run-tools:turn:1", "run-tools:turn:2"]);
    expect(agent.state.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
      "toolResult",
      "assistant",
    ]);
  });

  it("returns a denied tool call to the model without executing it", async () => {
    let executed = false;
    const parameters = Type.Object({ path: Type.String() });
    const responses = [
      toolResponse({
        type: "toolCall",
        id: "call-denied",
        name: "write_file",
        arguments: { path: "secret.txt" },
      }),
      textResponse("I will not write it."),
    ];
    const agent = new Agent({
      initialState: {
        model,
        tools: [
          {
            name: "write_file",
            label: "Write file",
            description: "Write a file",
            parameters,
            execute: async () => {
              executed = true;
              return { content: [{ type: "text", text: "written" }] };
            },
          },
        ],
      },
      streamFn: () => responses.shift()!,
      beforeToolCall: async () => ({
        allow: false,
        reason: "User denied this write",
      }),
    });

    await agent.prompt("write a file");

    expect(executed).toBe(false);
    expect(agent.state.messages[2]).toMatchObject({
      role: "toolResult",
      isError: true,
      content: [{ text: "User denied this write" }],
    });
  });

  it("resumes pending tool calls without repeating completed calls", async () => {
    const executed: string[] = [];
    const parameters = Type.Object({ value: Type.String() });
    const assistant = createAssistantMessage(model);
    assistant.stopReason = "toolUse";
    assistant.content.push(
      {
        type: "toolCall",
        id: "completed-call",
        name: "echo",
        arguments: { value: "done" },
      },
      {
        type: "toolCall",
        id: "pending-call",
        name: "echo",
        arguments: { value: "pending" },
      },
    );
    const echoTool: AgentTool<typeof parameters> = {
      name: "echo",
      label: "Echo",
      description: "Echo",
      parameters,
      execute: async (callId, arguments_) => {
        executed.push(callId);
        return {
          content: [{ type: "text", text: arguments_.value }],
        };
      },
    };
    const agent = new Agent({
      initialState: {
        model,
        messages: [
          assistant,
          {
            role: "toolResult",
            toolCallId: "completed-call",
            toolName: "echo",
            content: [{ type: "text", text: "done" }],
            isError: false,
            timestamp: 1,
          },
        ],
        tools: [echoTool],
      },
      streamFn: () => textResponse("resumed"),
      beforeToolCall: async () => ({ allow: true }),
    });

    await agent.resumePendingTools({
      runId: "resume-run",
      turnId: "resume-run:turn:1",
      turn: 1,
    });

    expect(executed).toEqual(["pending-call"]);
    expect(
      agent.state.messages.filter((message) => message.role === "toolResult"),
    ).toHaveLength(2);
  });

  it("propagates cancellation through the stream signal", async () => {
    const streamFn = (
      _model: Model,
      _context: Context,
      options: StreamOptions & { signal: AbortSignal },
    ) => {
      const stream = new AssistantMessageEventStream();
      const abort = () => {
        const message = createAssistantMessage(model);
        message.stopReason = "aborted";
        message.errorMessage = "aborted";
        stream.push({ type: "error", reason: "aborted", error: message });
      };
      if (options.signal.aborted) {
        queueMicrotask(abort);
      } else {
        options.signal.addEventListener("abort", abort, { once: true });
      }
      return stream;
    };
    const agent = new Agent({ initialState: { model }, streamFn });

    const running = agent.prompt("wait");
    agent.abort();
    await running;

    expect(agent.state.errorMessage).toBe("aborted");
    expect(agent.state.isStreaming).toBe(false);
  });
});
