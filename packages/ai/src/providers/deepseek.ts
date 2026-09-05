import OpenAI from "openai";

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

export const DEEPSEEK_MODELS: readonly Model[] = [
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    reasoning: true,
    input: ["text"],
    cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 384_000,
  },
  {
    id: "deepseek-v4-flash-vision-exp",
    name: "DeepSeek V4 Flash Vision Exp",
    api: "openai-completions",
    provider: "deepseek",
    baseUrl: "https://api.deepseek.com",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.14, output: 0.28, cacheRead: 0.0028, cacheWrite: 0 },
    contextWindow: 1_000_000,
    maxTokens: 384_000,
  },
] as const;

export interface DeepSeekChunk {
  id?: string;
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
}

export interface DeepSeekRequest {
  model: string;
  messages: unknown[];
  stream: true;
  stream_options: { include_usage: true };
  tools?: unknown[];
  max_tokens: number;
  temperature?: number;
  thinking?: { type: "enabled" | "disabled" };
  reasoning_effort?: string;
}

export type DeepSeekStreamFactory = (
  request: DeepSeekRequest,
  options: {
    apiKey: string;
    baseUrl: string;
    signal?: AbortSignal;
  },
) => Promise<AsyncIterable<DeepSeekChunk>>;

function textOf(blocks: readonly (TextContent | ImageContent)[]): string {
  return blocks
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function convertMessage(message: Message): unknown {
  if (message.role === "user") {
    if (typeof message.content === "string") {
      return { role: "user", content: message.content };
    }
    return {
      role: "user",
      content: message.content.map((block) =>
        block.type === "text"
          ? { type: "text", text: block.text }
          : {
              type: "image_url",
              image_url: {
                url: `data:${block.mimeType};base64,${block.data}`,
              },
            },
      ),
    };
  }

  if (message.role === "toolResult") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: textOf(message.content),
    };
  }

  const text = message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  const thinking = message.content
    .filter((block): block is ThinkingContent => block.type === "thinking")
    .map((block) => block.thinking)
    .join("\n");
  const toolCalls = message.content.filter(
    (block): block is ToolCall => block.type === "toolCall",
  );
  return {
    role: "assistant",
    content: text || null,
    reasoning_content: thinking,
    ...(toolCalls.length > 0
      ? {
          tool_calls: toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: {
              name: call.name,
              arguments: JSON.stringify(call.arguments),
            },
          })),
        }
      : {}),
  };
}

export function buildDeepSeekRequest(
  model: Model,
  context: Context,
  options: ProviderStreamOptions,
): DeepSeekRequest {
  const messages = context.messages.map(convertMessage);
  if (context.systemPrompt) {
    messages.unshift({ role: "system", content: context.systemPrompt });
  }

  const request: DeepSeekRequest = {
    model: model.id,
    messages,
    stream: true,
    stream_options: { include_usage: true },
    max_tokens: Math.min(options.maxTokens ?? model.maxTokens, model.maxTokens),
  };
  if (context.tools?.length) {
    request.tools = context.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }
  if (options.temperature !== undefined) {
    request.temperature = options.temperature;
  }
  if (model.reasoning) {
    const enabled = options.reasoning !== undefined && options.reasoning !== "off";
    request.thinking = { type: enabled ? "enabled" : "disabled" };
    if (enabled && options.reasoning) {
      request.reasoning_effort = options.reasoning;
    }
  }
  return request;
}

const defaultStreamFactory: DeepSeekStreamFactory = async (
  request,
  options,
) => {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseUrl,
  });
  return (await client.chat.completions.create(
    request as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
    options.signal ? { signal: options.signal } : undefined,
  )) as unknown as AsyncIterable<DeepSeekChunk>;
};

function parseArguments(value: string): Record<string, unknown> {
  if (!value) {
    return {};
  }
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
  reason: string | null | undefined,
  hasTools: boolean,
): "stop" | "length" | "toolUse" {
  if (reason === "length") {
    return "length";
  }
  if (reason === "tool_calls" || hasTools) {
    return "toolUse";
  }
  return "stop";
}

export function streamDeepSeek(
  model: Model,
  context: Context,
  options: ProviderStreamOptions,
  createStream: DeepSeekStreamFactory = defaultStreamFactory,
): AssistantMessageEventStream {
  const events = new AssistantMessageEventStream();
  const output = createAssistantMessage(model);

  void (async () => {
    try {
      const source = await createStream(
        buildDeepSeekRequest(model, context, options),
        {
          apiKey: options.apiKey,
          baseUrl: model.baseUrl,
          ...(options.signal ? { signal: options.signal } : {}),
        },
      );
      events.push({ type: "start", partial: output });

      let textBlock: TextContent | undefined;
      let thinkingBlock: ThinkingContent | undefined;
      const tools = new Map<
        number,
        { block: ToolCall; argumentsJson: string; contentIndex: number }
      >();
      let rawStopReason: string | null | undefined;

      for await (const chunk of source) {
        if (chunk.usage) {
          output.usage = calculateUsage(model, {
            input: chunk.usage.prompt_tokens ?? 0,
            output: chunk.usage.completion_tokens ?? 0,
            cacheRead: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
            ...(chunk.usage.completion_tokens_details?.reasoning_tokens !==
            undefined
              ? {
                  reasoning:
                    chunk.usage.completion_tokens_details.reasoning_tokens,
                }
              : {}),
          });
        }

        const choice = chunk.choices?.[0];
        if (!choice) {
          continue;
        }
        rawStopReason = choice.finish_reason ?? rawStopReason;
        const delta = choice.delta;
        if (!delta) {
          continue;
        }

        if (delta.reasoning_content) {
          if (!thinkingBlock) {
            thinkingBlock = { type: "thinking", thinking: "" };
            output.content.push(thinkingBlock);
            events.push({
              type: "thinking_start",
              contentIndex: output.content.length - 1,
              partial: output,
            });
          }
          thinkingBlock.thinking += delta.reasoning_content;
          events.push({
            type: "thinking_delta",
            contentIndex: output.content.indexOf(thinkingBlock),
            delta: delta.reasoning_content,
            partial: output,
          });
        }

        if (delta.content) {
          if (!textBlock) {
            textBlock = { type: "text", text: "" };
            output.content.push(textBlock);
            events.push({
              type: "text_start",
              contentIndex: output.content.length - 1,
              partial: output,
            });
          }
          textBlock.text += delta.content;
          events.push({
            type: "text_delta",
            contentIndex: output.content.indexOf(textBlock),
            delta: delta.content,
            partial: output,
          });
        }

        for (const toolDelta of delta.tool_calls ?? []) {
          let tool = tools.get(toolDelta.index);
          if (!tool) {
            const block: ToolCall = {
              type: "toolCall",
              id: toolDelta.id ?? "",
              name: toolDelta.function?.name ?? "",
              arguments: {},
            };
            output.content.push(block);
            tool = {
              block,
              argumentsJson: "",
              contentIndex: output.content.length - 1,
            };
            tools.set(toolDelta.index, tool);
            events.push({
              type: "toolcall_start",
              contentIndex: tool.contentIndex,
              partial: output,
            });
          }
          if (toolDelta.id) {
            tool.block.id = toolDelta.id;
          }
          if (toolDelta.function?.name) {
            tool.block.name = toolDelta.function.name;
          }
          const argumentDelta = toolDelta.function?.arguments ?? "";
          tool.argumentsJson += argumentDelta;
          tool.block.arguments = parseArguments(tool.argumentsJson);
          events.push({
            type: "toolcall_delta",
            contentIndex: tool.contentIndex,
            delta: argumentDelta,
            partial: output,
          });
        }
      }

      if (thinkingBlock) {
        events.push({
          type: "thinking_end",
          contentIndex: output.content.indexOf(thinkingBlock),
          content: thinkingBlock.thinking,
          partial: output,
        });
      }
      if (textBlock) {
        events.push({
          type: "text_end",
          contentIndex: output.content.indexOf(textBlock),
          content: textBlock.text,
          partial: output,
        });
      }
      for (const tool of tools.values()) {
        tool.block.arguments = parseArguments(tool.argumentsJson);
        events.push({
          type: "toolcall_end",
          contentIndex: tool.contentIndex,
          toolCall: tool.block,
          partial: output,
        });
      }

      const reason = mapStopReason(rawStopReason, tools.size > 0);
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

export function deepseekProvider(options?: {
  createStream?: DeepSeekStreamFactory;
}): Provider {
  return {
    id: "deepseek",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    models: DEEPSEEK_MODELS,
    stream: (model, context, streamOptions) =>
      streamDeepSeek(
        model,
        context,
        streamOptions,
        options?.createStream ?? defaultStreamFactory,
      ),
  };
}
