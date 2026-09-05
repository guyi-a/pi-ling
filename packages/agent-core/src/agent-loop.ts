import {
  createAssistantMessage,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type ThinkingLevel,
  type ToolCall,
  type ToolResultMessage,
  type UserMessage,
} from "@pi-ling/ai";
import { Value } from "typebox/value";

import type {
  AgentEvent,
  AgentTool,
  BeforeToolCall,
  StreamFunction,
} from "./types.js";

export interface RunAgentLoopOptions {
  runId: string;
  context: Context;
  model: Model;
  reasoning: ThinkingLevel;
  tools: AgentTool[];
  prompt?: UserMessage;
  signal: AbortSignal;
  streamFn: StreamFunction;
  beforeToolCall?: BeforeToolCall;
  emit(event: AgentEvent): void | Promise<void>;
  maxTurns: number;
  startTurn?: number;
  emitAgentStart?: boolean;
}

function toolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter(
    (block): block is ToolCall => block.type === "toolCall",
  );
}

function validationError(tool: AgentTool, arguments_: unknown): string {
  const errors = [...Value.Errors(tool.parameters, arguments_)];
  if (errors.length === 0) {
    return `Invalid arguments for tool ${tool.name}`;
  }
  return errors
    .slice(0, 3)
    .map((error) => error.message)
    .join("; ");
}

async function executeTool(
  call: ToolCall,
  tools: readonly AgentTool[],
  context: Context,
  runId: string,
  turnId: string,
  signal: AbortSignal,
  beforeToolCall: BeforeToolCall | undefined,
  onStart: () => void | Promise<void>,
): Promise<ToolResultMessage> {
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (!tool) {
    return {
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: [{ type: "text", text: `Unknown tool: ${call.name}` }],
      isError: true,
      timestamp: Date.now(),
    };
  }

  const arguments_ = structuredClone(call.arguments);
  Value.Convert(tool.parameters, arguments_);
  if (!Value.Check(tool.parameters, arguments_)) {
    return {
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: [
        {
          type: "text",
          text: validationError(tool, arguments_),
        },
      ],
      isError: true,
      timestamp: Date.now(),
    };
  }

  if (beforeToolCall) {
    const decision = await beforeToolCall(
      {
        runId,
        turnId,
        toolCall: call,
        tool,
        arguments: arguments_,
        context,
      },
      signal,
    );
    if (!decision.allow) {
      return {
        role: "toolResult",
        toolCallId: call.id,
        toolName: call.name,
        content: [
          {
            type: "text",
            text: decision.reason ?? "Tool call denied by user",
          },
        ],
        isError: true,
        timestamp: Date.now(),
      };
    }
  }

  try {
    await onStart();
    const result = await tool.execute(call.id, arguments_ as never, signal);
    return {
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: result.content,
      isError: false,
      timestamp: Date.now(),
    };
  } catch (error) {
    return {
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: [
        {
          type: "text",
          text: error instanceof Error ? error.message : String(error),
        },
      ],
      isError: true,
      timestamp: Date.now(),
    };
  }
}

export async function runAgentLoop(
  options: RunAgentLoopOptions,
): Promise<Message[]> {
  const produced: Message[] = options.prompt ? [options.prompt] : [];
  const context: Context = {
    ...options.context,
    messages: [
      ...options.context.messages,
      ...(options.prompt ? [options.prompt] : []),
    ],
    tools: options.tools,
  };

  if (options.emitAgentStart !== false) {
    await options.emit({ type: "agent_start", runId: options.runId });
  }
  if (options.prompt) {
    await options.emit({
      type: "message_start",
      runId: options.runId,
      message: options.prompt,
    });
    await options.emit({
      type: "message_end",
      runId: options.runId,
      message: options.prompt,
    });
  }

  for (
    let turn = options.startTurn ?? 1;
    turn <= options.maxTurns;
    turn += 1
  ) {
    const turnId = `${options.runId}:turn:${turn}`;
    await options.emit({
      type: "turn_start",
      runId: options.runId,
      turnId,
      turn,
    });
    const stream = options.streamFn(options.model, context, {
      signal: options.signal,
      ...(options.reasoning !== "off"
        ? { reasoning: options.reasoning }
        : {}),
    });

    let started = false;
    for await (const event of stream) {
      const message =
        event.type === "done"
          ? event.message
          : event.type === "error"
            ? event.error
            : event.partial;
      if (!started) {
        started = true;
        await options.emit({
          type: "message_start",
          runId: options.runId,
          turnId,
          message,
        });
      }
      await options.emit({
        type: "message_update",
        runId: options.runId,
        turnId,
        message,
        assistantMessageEvent: event,
      });
    }

    const assistant = await stream.result();
    if (!started) {
      await options.emit({
        type: "message_start",
        runId: options.runId,
        turnId,
        message: assistant,
      });
    }
    await options.emit({
      type: "message_end",
      runId: options.runId,
      turnId,
      message: assistant,
    });
    context.messages.push(assistant);
    produced.push(assistant);

    const calls = toolCalls(assistant);
    if (
      assistant.stopReason === "error" ||
      assistant.stopReason === "aborted" ||
      calls.length === 0
    ) {
      await options.emit({
        type: "turn_end",
        runId: options.runId,
        turnId,
        turn,
        message: assistant,
        toolResults: [],
      });
      await options.emit({
        type: "agent_end",
        runId: options.runId,
        messages: produced,
      });
      return produced;
    }

    const results: ToolResultMessage[] = [];
    for (const call of calls) {
      const result = await executeTool(
        call,
        options.tools,
        context,
        options.runId,
        turnId,
        options.signal,
        options.beforeToolCall,
        () =>
          options.emit({
            type: "tool_execution_start",
            runId: options.runId,
            turnId,
            toolCall: call,
          }),
      );
      await options.emit({
        type: "tool_execution_end",
        runId: options.runId,
        turnId,
        toolCall: call,
        result,
      });
      await options.emit({
        type: "message_start",
        runId: options.runId,
        turnId,
        message: result,
      });
      await options.emit({
        type: "message_end",
        runId: options.runId,
        turnId,
        message: result,
      });
      context.messages.push(result);
      produced.push(result);
      results.push(result);
    }
    await options.emit({
      type: "turn_end",
      runId: options.runId,
      turnId,
      turn,
      message: assistant,
      toolResults: results,
    });
  }

  const failure = createAssistantMessage(options.model);
  failure.stopReason = "error";
  failure.errorMessage = `Agent exceeded ${options.maxTurns} turns`;
  const finalTurnId = `${options.runId}:turn:${options.maxTurns}`;
  await options.emit({
    type: "message_start",
    runId: options.runId,
    turnId: finalTurnId,
    message: failure,
  });
  await options.emit({
    type: "message_end",
    runId: options.runId,
    turnId: finalTurnId,
    message: failure,
  });
  produced.push(failure);
  await options.emit({
    type: "agent_end",
    runId: options.runId,
    messages: produced,
  });
  return produced;
}

export interface ResumeAgentLoopOptions
  extends Omit<
    RunAgentLoopOptions,
    "prompt" | "startTurn" | "emitAgentStart"
  > {
  assistant: AssistantMessage;
  turn: number;
  turnId: string;
}

export async function resumeAgentLoop(
  options: ResumeAgentLoopOptions,
): Promise<Message[]> {
  const context: Context = {
    ...options.context,
    messages: [...options.context.messages],
    tools: options.tools,
  };
  const produced: Message[] = [];
  const completedCalls = new Set(
    context.messages
      .filter((message) => message.role === "toolResult")
      .map((message) => message.toolCallId),
  );

  await options.emit({ type: "agent_start", runId: options.runId });
  const results: ToolResultMessage[] = [];
  for (const call of toolCalls(options.assistant)) {
    if (completedCalls.has(call.id)) {
      continue;
    }
    const result = await executeTool(
      call,
      options.tools,
      context,
      options.runId,
      options.turnId,
      options.signal,
      options.beforeToolCall,
      () =>
        options.emit({
          type: "tool_execution_start",
          runId: options.runId,
          turnId: options.turnId,
          toolCall: call,
        }),
    );
    await options.emit({
      type: "tool_execution_end",
      runId: options.runId,
      turnId: options.turnId,
      toolCall: call,
      result,
    });
    await options.emit({
      type: "message_start",
      runId: options.runId,
      turnId: options.turnId,
      message: result,
    });
    await options.emit({
      type: "message_end",
      runId: options.runId,
      turnId: options.turnId,
      message: result,
    });
    context.messages.push(result);
    produced.push(result);
    results.push(result);
  }
  await options.emit({
    type: "turn_end",
    runId: options.runId,
    turnId: options.turnId,
    turn: options.turn,
    message: options.assistant,
    toolResults: results,
  });

  const continuation = await runAgentLoop({
    runId: options.runId,
    context,
    model: options.model,
    reasoning: options.reasoning,
    tools: options.tools,
    signal: options.signal,
    streamFn: options.streamFn,
    ...(options.beforeToolCall
      ? { beforeToolCall: options.beforeToolCall }
      : {}),
    emit: options.emit,
    maxTurns: options.maxTurns,
    startTurn: options.turn + 1,
    emitAgentStart: false,
  });
  return [...produced, ...continuation];
}
