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
  StreamFunction,
} from "./types.js";

export interface RunAgentLoopOptions {
  context: Context;
  model: Model;
  reasoning: ThinkingLevel;
  tools: AgentTool[];
  prompt: UserMessage;
  signal: AbortSignal;
  streamFn: StreamFunction;
  emit(event: AgentEvent): void | Promise<void>;
  maxTurns: number;
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
  signal: AbortSignal,
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

  try {
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
  const produced: Message[] = [options.prompt];
  const context: Context = {
    ...options.context,
    messages: [...options.context.messages, options.prompt],
    tools: options.tools,
  };

  await options.emit({ type: "agent_start" });
  await options.emit({ type: "message_start", message: options.prompt });
  await options.emit({ type: "message_end", message: options.prompt });

  for (let turn = 1; turn <= options.maxTurns; turn += 1) {
    await options.emit({ type: "turn_start", turn });
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
        await options.emit({ type: "message_start", message });
      }
      await options.emit({
        type: "message_update",
        message,
        assistantMessageEvent: event,
      });
    }

    const assistant = await stream.result();
    if (!started) {
      await options.emit({ type: "message_start", message: assistant });
    }
    await options.emit({ type: "message_end", message: assistant });
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
        turn,
        message: assistant,
        toolResults: [],
      });
      await options.emit({ type: "agent_end", messages: produced });
      return produced;
    }

    const results: ToolResultMessage[] = [];
    for (const call of calls) {
      await options.emit({ type: "tool_execution_start", toolCall: call });
      const result = await executeTool(call, options.tools, options.signal);
      await options.emit({
        type: "tool_execution_end",
        toolCall: call,
        result,
      });
      await options.emit({ type: "message_start", message: result });
      await options.emit({ type: "message_end", message: result });
      context.messages.push(result);
      produced.push(result);
      results.push(result);
    }
    await options.emit({
      type: "turn_end",
      turn,
      message: assistant,
      toolResults: results,
    });
  }

  const failure = createAssistantMessage(options.model);
  failure.stopReason = "error";
  failure.errorMessage = `Agent exceeded ${options.maxTurns} turns`;
  await options.emit({ type: "message_start", message: failure });
  await options.emit({ type: "message_end", message: failure });
  produced.push(failure);
  await options.emit({ type: "agent_end", messages: produced });
  return produced;
}
