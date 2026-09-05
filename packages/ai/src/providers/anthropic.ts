import Anthropic from "@anthropic-ai/sdk";

import { AssistantMessageEventStream } from "../event-stream.js";
import {
  calculateUsage,
  createAssistantMessage,
  isAbortError,
} from "../message-utils.js";
import type {
  Context,
  ImageContent,
  Message,
  Model,
  TextContent,
  ThinkingContent,
  ToolCall,
} from "../types.js";
import type {
  Provider,
  ProviderStreamOptions,
} from "../models.js";

export const ANTHROPIC_MODELS: readonly Model[] = [
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    api: "anthropic-messages",
    provider: "anthropic",
    baseUrl: "https://api.anthropic.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
] as const;

export type AnthropicStreamEvent =
  | {
      type: "message_start";
      message: {
        usage: {
          input_tokens: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      };
    }
  | {
      type: "content_block_start";
      index: number;
      content_block:
        | { type: "text"; text: string }
        | { type: "thinking"; thinking: string; signature?: string }
        | {
            type: "tool_use";
            id: string;
            name: string;
            input: Record<string, unknown>;
          };
    }
  | {
      type: "content_block_delta";
      index: number;
      delta:
        | { type: "text_delta"; text: string }
        | { type: "thinking_delta"; thinking: string }
        | { type: "signature_delta"; signature: string }
        | { type: "input_json_delta"; partial_json: string };
    }
  | { type: "content_block_stop"; index: number }
  | {
      type: "message_delta";
      delta: { stop_reason?: string | null };
      usage: { output_tokens: number };
    }
  | { type: "message_stop" };

export interface AnthropicRequest {
  model: string;
  messages: unknown[];
  max_tokens: number;
  stream: true;
  system?: string;
  tools?: unknown[];
  thinking?: { type: "adaptive" };
  output_config?: { effort: "low" | "medium" | "high" };
  temperature?: number;
}

export type AnthropicStreamFactory = (
  request: AnthropicRequest,
  options: {
    apiKey: string;
    baseUrl: string;
    signal?: AbortSignal;
  },
) => Promise<AsyncIterable<AnthropicStreamEvent>>;

type AnthropicContent =
  | { type: "text"; text: string }
  | {
      type: "image";
      source: {
        type: "base64";
        media_type: string;
        data: string;
      };
    }
  | {
      type: "thinking";
      thinking: string;
      signature: string;
    }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: Array<
        | { type: "text"; text: string }
        | {
            type: "image";
            source: {
              type: "base64";
              media_type: string;
              data: string;
            };
          }
      >;
      is_error: boolean;
    };

function convertInputContent(
  content: string | readonly (TextContent | ImageContent)[],
): AnthropicContent[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content.map((block) =>
    block.type === "text"
      ? { type: "text", text: block.text }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: block.mimeType,
            data: block.data,
          },
        },
  );
}

function convertMessage(message: Message): {
  role: "user" | "assistant";
  content: AnthropicContent[];
} {
  if (message.role === "user") {
    return { role: "user", content: convertInputContent(message.content) };
  }
  if (message.role === "toolResult") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
          content: convertInputContent(message.content).filter(
            (
              block,
            ): block is Extract<
              AnthropicContent,
              { type: "text" | "image" }
            > => block.type === "text" || block.type === "image",
          ),
          is_error: message.isError,
        },
      ],
    };
  }

  const content: AnthropicContent[] = [];
  for (const block of message.content) {
    if (block.type === "text") {
      content.push({ type: "text", text: block.text });
    } else if (block.type === "thinking") {
      if (block.signature) {
        content.push({
          type: "thinking",
          thinking: block.thinking,
          signature: block.signature,
        });
      }
    } else {
      content.push({
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.arguments,
      });
    }
  }
  return { role: "assistant", content };
}

function convertMessages(messages: readonly Message[]): unknown[] {
  const converted: Array<{
    role: "user" | "assistant";
    content: AnthropicContent[];
  }> = [];
  for (const message of messages) {
    const next = convertMessage(message);
    const previous = converted.at(-1);
    if (previous?.role === next.role) {
      previous.content.push(...next.content);
    } else {
      converted.push(next);
    }
  }
  return converted;
}

export function buildAnthropicRequest(
  model: Model,
  context: Context,
  options: ProviderStreamOptions,
): AnthropicRequest {
  const request: AnthropicRequest = {
    model: model.id,
    messages: convertMessages(context.messages),
    max_tokens: Math.min(options.maxTokens ?? model.maxTokens, model.maxTokens),
    stream: true,
  };
  if (context.systemPrompt) {
    request.system = context.systemPrompt;
  }
  if (context.tools?.length) {
    request.tools = context.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
  if (options.reasoning && options.reasoning !== "off") {
    request.thinking = { type: "adaptive" };
    request.output_config = { effort: options.reasoning };
  }
  if (options.temperature !== undefined) {
    request.temperature = options.temperature;
  }
  return request;
}

const defaultStreamFactory: AnthropicStreamFactory = async (
  request,
  options,
) => {
  const client = new Anthropic({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
  });
  return (await client.messages.create(
    request as Anthropic.MessageCreateParamsStreaming,
    options.signal ? { signal: options.signal } : undefined,
  )) as unknown as AsyncIterable<AnthropicStreamEvent>;
};

function parseArguments(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function mapStopReason(
  value: string | null | undefined,
  hasTools: boolean,
): "stop" | "length" | "toolUse" {
  if (value === "max_tokens") {
    return "length";
  }
  if (value === "tool_use" || hasTools) {
    return "toolUse";
  }
  return "stop";
}

export function streamAnthropic(
  model: Model,
  context: Context,
  options: ProviderStreamOptions,
  createStream: AnthropicStreamFactory = defaultStreamFactory,
): AssistantMessageEventStream {
  const events = new AssistantMessageEventStream();
  const output = createAssistantMessage(model);

  void (async () => {
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let rawStopReason: string | null | undefined;
    const blocks = new Map<
      number,
      {
        contentIndex: number;
        block: TextContent | ThinkingContent | ToolCall;
        argumentsJson?: string;
      }
    >();

    try {
      const source = await createStream(
        buildAnthropicRequest(model, context, options),
        {
          apiKey: options.apiKey,
          baseUrl: model.baseUrl,
          ...(options.signal ? { signal: options.signal } : {}),
        },
      );
      events.push({ type: "start", partial: output });

      for await (const event of source) {
        if (event.type === "message_start") {
          inputTokens = event.message.usage.input_tokens;
          cacheRead = event.message.usage.cache_read_input_tokens ?? 0;
          cacheWrite = event.message.usage.cache_creation_input_tokens ?? 0;
          continue;
        }
        if (event.type === "message_delta") {
          rawStopReason = event.delta.stop_reason;
          outputTokens = event.usage.output_tokens;
          continue;
        }
        if (event.type === "content_block_start") {
          let block: TextContent | ThinkingContent | ToolCall;
          if (event.content_block.type === "text") {
            block = { type: "text", text: event.content_block.text };
          } else if (event.content_block.type === "thinking") {
            block = {
              type: "thinking",
              thinking: event.content_block.thinking,
              ...(event.content_block.signature
                ? { signature: event.content_block.signature }
                : {}),
            };
          } else {
            block = {
              type: "toolCall",
              id: event.content_block.id,
              name: event.content_block.name,
              arguments: event.content_block.input,
            };
          }
          output.content.push(block);
          const state = {
            block,
            contentIndex: output.content.length - 1,
            ...(block.type === "toolCall" ? { argumentsJson: "" } : {}),
          };
          blocks.set(event.index, state);
          events.push({
            type:
              block.type === "text"
                ? "text_start"
                : block.type === "thinking"
                  ? "thinking_start"
                  : "toolcall_start",
            contentIndex: state.contentIndex,
            partial: output,
          });
          continue;
        }
        if (event.type === "content_block_delta") {
          const state = blocks.get(event.index);
          if (!state) {
            continue;
          }
          if (
            event.delta.type === "text_delta" &&
            state.block.type === "text"
          ) {
            state.block.text += event.delta.text;
            events.push({
              type: "text_delta",
              contentIndex: state.contentIndex,
              delta: event.delta.text,
              partial: output,
            });
          } else if (
            event.delta.type === "thinking_delta" &&
            state.block.type === "thinking"
          ) {
            state.block.thinking += event.delta.thinking;
            events.push({
              type: "thinking_delta",
              contentIndex: state.contentIndex,
              delta: event.delta.thinking,
              partial: output,
            });
          } else if (
            event.delta.type === "signature_delta" &&
            state.block.type === "thinking"
          ) {
            state.block.signature =
              (state.block.signature ?? "") + event.delta.signature;
          } else if (
            event.delta.type === "input_json_delta" &&
            state.block.type === "toolCall"
          ) {
            state.argumentsJson =
              (state.argumentsJson ?? "") + event.delta.partial_json;
            state.block.arguments = parseArguments(state.argumentsJson);
            events.push({
              type: "toolcall_delta",
              contentIndex: state.contentIndex,
              delta: event.delta.partial_json,
              partial: output,
            });
          }
          continue;
        }
        if (event.type === "content_block_stop") {
          const state = blocks.get(event.index);
          if (!state) {
            continue;
          }
          if (state.block.type === "text") {
            events.push({
              type: "text_end",
              contentIndex: state.contentIndex,
              content: state.block.text,
              partial: output,
            });
          } else if (state.block.type === "thinking") {
            events.push({
              type: "thinking_end",
              contentIndex: state.contentIndex,
              content: state.block.thinking,
              partial: output,
            });
          } else {
            state.block.arguments = parseArguments(state.argumentsJson ?? "");
            events.push({
              type: "toolcall_end",
              contentIndex: state.contentIndex,
              toolCall: state.block,
              partial: output,
            });
          }
        }
      }

      output.usage = calculateUsage(model, {
        input: inputTokens,
        output: outputTokens,
        cacheRead,
        cacheWrite,
      });
      const hasTools = output.content.some(
        (block) => block.type === "toolCall",
      );
      const reason = mapStopReason(rawStopReason, hasTools);
      output.stopReason = reason;
      events.push({ type: "done", reason, message: output });
    } catch (error) {
      const aborted = isAbortError(error, options.signal);
      output.stopReason = aborted ? "aborted" : "error";
      output.errorMessage =
        error instanceof Error ? error.message : String(error);
      events.push({
        type: "error",
        reason: aborted ? "aborted" : "error",
        error: output,
      });
    }
  })();

  return events;
}

export function anthropicProvider(options?: {
  createStream?: AnthropicStreamFactory;
}): Provider {
  return {
    id: "anthropic",
    apiKeyEnv: "ANTHROPIC_API_KEY",
    models: ANTHROPIC_MODELS,
    stream: (model, context, streamOptions) =>
      streamAnthropic(
        model,
        context,
        streamOptions,
        options?.createStream ?? defaultStreamFactory,
      ),
  };
}
