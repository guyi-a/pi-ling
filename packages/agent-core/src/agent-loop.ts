import {
  type AssistantMessage,
  type Api,
  type Context,
  type Message,
  type Model,
  type ModelThinkingLevel,
  type ToolCall,
  type ToolResultMessage,
  type Usage,
  type UserMessage,
} from "@earendil-works/pi-ai";
import { Value } from "typebox/value";

import { pruneContextToolResults } from "./intra-pruner.js";
import type {
  AgentEvent,
  AgentTool,
  BeforeToolCall,
  StreamFunction,
} from "./types.js";

export interface RunAgentLoopOptions {
  runId: string;
  context: Context;
  model: Model<Api>;
  reasoning: ModelThinkingLevel;
  tools: AgentTool[];
  prompt?: UserMessage;
  signal: AbortSignal;
  streamFn: StreamFunction;
  beforeToolCall?: BeforeToolCall;
  prepareContext?: (context: Context) => Context | Promise<Context>;
  recoverContextOverflow?: (
    context: Context,
  ) => Context | undefined | Promise<Context | undefined>;
  wrapToolResult?: (
    toolCallId: string,
    result: ToolResultMessage,
  ) => ToolResultMessage | Promise<ToolResultMessage>;
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

function emptyUsage(): Usage {
  return {
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
  };
}

function failureMessage(
  model: Model<Api>,
  errorMessage: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: emptyUsage(),
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  };
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

export const RUN_CANCELLED_BY_USER = "Run cancelled by user";

function failedToolResult(
  call: ToolCall,
  error: unknown,
): ToolResultMessage {
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

function cancellationToolResult(
  call: ToolCall,
  signal: AbortSignal,
  error?: unknown,
): ToolResultMessage {
  const reason =
    error instanceof Error &&
    error.message.trim() &&
    error.name !== "AbortError" &&
    error.message !== "Aborted"
      ? error.message
      : signal.reason instanceof Error && signal.reason.message.trim()
        ? signal.reason.message
        : RUN_CANCELLED_BY_USER;
  return failedToolResult(call, reason);
}

async function executeTool(
  call: ToolCall,
  tools: readonly AgentTool[],
  context: Context,
  runId: string,
  turnId: string,
  signal: AbortSignal,
  beforeToolCall: BeforeToolCall | undefined,
  wrapToolResult:
    | ((toolCallId: string, result: ToolResultMessage) => ToolResultMessage | Promise<ToolResultMessage>)
    | undefined,
  onStart: () => void | Promise<void>,
): Promise<ToolResultMessage> {
  if (signal.aborted) {
    return cancellationToolResult(call, signal);
  }
  const tool = tools.find((candidate) => candidate.name === call.name);
  if (!tool) {
    return failedToolResult(call, `Unknown tool: ${call.name}`);
  }

  try {
    const arguments_ = structuredClone(call.arguments);
    Value.Convert(tool.parameters, arguments_);
    if (!Value.Check(tool.parameters, arguments_)) {
      return failedToolResult(
        call,
        validationError(tool, arguments_),
      );
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
        return failedToolResult(
          call,
          decision.reason ?? "Tool call denied by user",
        );
      }
      if (signal.aborted) {
        return cancellationToolResult(call, signal);
      }
    }

    await onStart();
    if (signal.aborted) {
      return cancellationToolResult(call, signal);
    }
    const result = await tool.execute(call.id, arguments_ as never, signal);
    const toolResult: ToolResultMessage = {
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: result.content,
      isError: false,
      timestamp: Date.now(),
    };
    return wrapToolResult
      ? await wrapToolResult(call.id, toolResult)
      : toolResult;
  } catch (error) {
    if (signal.aborted) {
      return cancellationToolResult(call, signal, error);
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    const failed = failedToolResult(call, error);
    return wrapToolResult
      ? await wrapToolResult(call.id, failed)
      : failed;
  }
}

function isContextOverflowError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const normalized = message.toLowerCase();
  return (
    normalized.includes("context") &&
    (normalized.includes("overflow") ||
      normalized.includes("too long") ||
      normalized.includes("maximum") ||
      normalized.includes("exceed"))
  );
}

async function prepareModelContext(
  options: Pick<
    RunAgentLoopOptions,
    "context" | "prepareContext"
  >,
): Promise<Context> {
  let next: Context = {
    ...options.context,
    messages: pruneContextToolResults(options.context.messages),
  };
  if (options.prepareContext) {
    next = await options.prepareContext(next);
  }
  return next;
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

    let modelContext = await prepareModelContext({
      context,
      ...(options.prepareContext
        ? { prepareContext: options.prepareContext }
        : {}),
    });
    let overflowRetried = false;
    let assistant!: AssistantMessage;
    let started = false;

    while (true) {
      const stream = options.streamFn(options.model, modelContext, {
        signal: options.signal,
        ...(options.reasoning !== "off"
          ? { reasoning: options.reasoning }
          : {}),
      });
      try {
        started = false;
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
        assistant = await stream.result();
        context.messages = modelContext.messages;
        break;
      } catch (error) {
        if (
          !overflowRetried &&
          options.recoverContextOverflow &&
          isContextOverflowError(error)
        ) {
          const recovered = await options.recoverContextOverflow(modelContext);
          if (recovered) {
            modelContext = recovered;
            context.messages = recovered.messages;
            overflowRetried = true;
            continue;
          }
        }
        throw error;
      }
    }

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
        options.wrapToolResult,
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
    if (options.signal.aborted) {
      await options.emit({
        type: "agent_end",
        runId: options.runId,
        messages: produced,
      });
      return produced;
    }
  }

  const failure = failureMessage(
    options.model,
    `Agent exceeded ${options.maxTurns} turns`,
  );
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
      options.wrapToolResult,
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
  if (options.signal.aborted) {
    await options.emit({
      type: "agent_end",
      runId: options.runId,
      messages: produced,
    });
    return produced;
  }

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
    ...(options.prepareContext
      ? { prepareContext: options.prepareContext }
      : {}),
    ...(options.recoverContextOverflow
      ? { recoverContextOverflow: options.recoverContextOverflow }
      : {}),
    ...(options.wrapToolResult
      ? { wrapToolResult: options.wrapToolResult }
      : {}),
    emit: options.emit,
    maxTurns: options.maxTurns,
    startTurn: options.turn + 1,
    emitAgentStart: false,
  });
  return [...produced, ...continuation];
}
