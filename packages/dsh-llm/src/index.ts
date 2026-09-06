import type { Context as CordisContext } from "@deepseek-ai/cordis";
import {
  LlmAdapter,
  type GenerateOptions,
  type LlmModelInfo,
  type LlmResolvedModelInfo,
  type Message as DshMessage,
  type StreamChunk,
  type ToolCallId,
} from "@deepseek-ai/dsh-llm";
import {
  createModels,
  emptyUsage,
  type AssistantMessage,
  type Context,
  type Message,
  type Model,
  type ThinkingLevel,
} from "@pi-ling/ai";
import { anthropicProvider } from "@pi-ling/ai/providers/anthropic";
import { deepseekProvider } from "@pi-ling/ai/providers/deepseek";

export const name = "pi-ling-llm";
export const inject = ["llm"];

export interface Config {
  deepseekRoute?: string;
  anthropicRoute?: string;
}

const models = createModels([deepseekProvider(), anthropicProvider()]);

function flattenText(blocks: readonly DshMessage["content"][number][]): string {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

export function toPiContext(options: GenerateOptions): Context {
  const output: Message[] = [];
  const toolNames = new Map<string, string>();
  for (const message of options.messages) {
    if (message.role === "assistant") {
      const content: AssistantMessage["content"] = [];
      for (const block of message.content) {
        if (block.type === "text") {
          content.push({ type: "text", text: block.text });
        } else if (block.type === "reasoning") {
          content.push({ type: "thinking", thinking: block.text });
        } else if (block.type === "tool-call") {
          let arguments_: Record<string, unknown> = {};
          try {
            arguments_ = JSON.parse(block.arguments) as Record<string, unknown>;
          } catch {}
          content.push({
            type: "toolCall",
            id: block.id,
            name: block.name,
            arguments: arguments_,
          });
          toolNames.set(block.id, block.name);
        }
      }
      output.push({
        role: "assistant",
        content,
        api:
          options.provider.includes("anthropic")
            ? "anthropic-messages"
            : "openai-completions",
        provider: options.provider.includes("anthropic")
          ? "anthropic"
          : "deepseek",
        model: options.model,
        usage: emptyUsage(),
        stopReason: "stop",
        timestamp: 0,
      });
      continue;
    }
    const toolResults = message.content.filter(
      (block) => block.type === "tool-result",
    );
    const text = flattenText(message.content);
    if (text || toolResults.length === 0) {
      output.push({ role: "user", content: text, timestamp: 0 });
    }
    for (const result of toolResults) {
      output.push({
        role: "toolResult",
        toolCallId: result.toolCallId,
        toolName: toolNames.get(result.toolCallId) ?? "unknown",
        content: [
          {
            type: "text",
            text: flattenText(result.content) || "(no output)",
          },
        ],
        isError: result.isError ?? false,
        timestamp: 0,
      });
    }
  }
  return {
    ...(options.system ? { systemPrompt: options.system } : {}),
    messages: output,
    ...(options.tools?.length
      ? {
          tools: options.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        }
      : {}),
  };
}

function resolveRoute(
  route: string,
): { provider: "deepseek" | "anthropic"; displayName: string } {
  return route.includes("anthropic")
    ? { provider: "anthropic", displayName: "Anthropic via pi-ling" }
    : { provider: "deepseek", displayName: "DeepSeek via pi-ling" };
}

export class PiLingLlmAdapter extends LlmAdapter {
  constructor(readonly routes: readonly string[]) {
    super();
  }

  override providerInfo(provider: string) {
    return { id: provider, name: resolveRoute(provider).displayName };
  }

  override listModels(provider: string): Promise<readonly LlmModelInfo[]> {
    const route = resolveRoute(provider);
    return Promise.resolve(
      models.getModels(route.provider).map((model) => ({
        provider,
        id: model.id,
        name: model.name,
        inputModalities: model.input,
      })),
    );
  }

  override async resolveModel(
    provider: string,
    modelId: string,
  ): Promise<LlmResolvedModelInfo> {
    const route = resolveRoute(provider);
    const model = models.getModel(route.provider, modelId);
    if (!model) {
      return { provider, id: modelId, name: modelId };
    }
    return {
      provider,
      id: model.id,
      name: model.name,
      inputModalities: model.input,
      context: { contextWindow: model.contextWindow },
      defaultMaxTokens: model.maxTokens,
    };
  }

  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const route = resolveRoute(options.provider);
    const model = models.getModel(route.provider, options.model);
    if (!model) throw new Error(`Unknown model: ${options.model}`);
    const stream = models.stream(model, toPiContext(options), {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
      ...(options.temperature !== undefined
        ? { temperature: options.temperature }
        : {}),
      ...(options.reasoningEffort
        ? {
            reasoning: String(options.reasoningEffort) as ThinkingLevel,
          }
        : {}),
    });
    const toolIds = new Map<number, { id: string; name: string }>();
    for await (const event of stream) {
      switch (event.type) {
        case "start":
          break;
        case "text_start":
          yield {
            type: "block-start",
            index: event.contentIndex,
            blockType: "text",
          };
          break;
        case "text_delta":
          yield {
            type: "text-delta",
            index: event.contentIndex,
            text: event.delta,
          };
          break;
        case "text_end":
          yield {
            type: "block-end",
            index: event.contentIndex,
            block: { type: "text", text: event.content },
          };
          break;
        case "thinking_start":
          yield {
            type: "block-start",
            index: event.contentIndex,
            blockType: "reasoning",
          };
          break;
        case "thinking_delta":
          yield {
            type: "reasoning-delta",
            index: event.contentIndex,
            text: event.delta,
          };
          break;
        case "thinking_end":
          yield {
            type: "block-end",
            index: event.contentIndex,
            block: { type: "reasoning", text: event.content },
          };
          break;
        case "toolcall_start": {
          const block = event.partial.content[event.contentIndex];
          if (block?.type === "toolCall") {
            toolIds.set(event.contentIndex, {
              id: block.id,
              name: block.name,
            });
          }
          yield {
            type: "block-start",
            index: event.contentIndex,
            blockType: "tool-call",
          };
          break;
        }
        case "toolcall_delta": {
          const tool = toolIds.get(event.contentIndex);
          yield {
            type: "tool-call-delta",
            index: event.contentIndex,
            id: (tool?.id ?? "") as ToolCallId,
            ...(tool?.name ? { name: tool.name } : {}),
            argumentsDelta: event.delta,
          };
          break;
        }
        case "toolcall_end":
          yield {
            type: "block-end",
            index: event.contentIndex,
            block: {
              type: "tool-call",
              id: event.toolCall.id as ToolCallId,
              name: event.toolCall.name,
              arguments: JSON.stringify(event.toolCall.arguments),
            },
          };
          break;
        case "done":
        case "error": {
          const message =
            event.type === "done" ? event.message : event.error;
          yield {
            type: "usage",
            usage: {
              inputTokens: message.usage.input,
              outputTokens: message.usage.output,
              totalTokens: message.usage.totalTokens,
              ...(message.usage.cacheRead
                ? { cacheReadTokens: message.usage.cacheRead }
                : {}),
              ...(message.usage.cacheWrite
                ? { cacheWriteTokens: message.usage.cacheWrite }
                : {}),
            },
          };
          yield {
            type: "finish",
            reason:
              message.stopReason === "stop"
                ? { kind: "stop" }
                : message.stopReason === "toolUse"
                  ? { kind: "tool-calls" }
                  : message.stopReason === "length"
                    ? { kind: "max-tokens" }
                    : message.stopReason === "aborted"
                      ? {
                          kind: "aborted",
                          failure: {
                            message: message.errorMessage ?? "aborted",
                            code: "ABORTED",
                          },
                        }
                      : {
                          kind: "error",
                          failure: {
                            message: message.errorMessage ?? "model error",
                            code: "PI_LING_AI_ERROR",
                          },
                        },
          };
          return;
        }
      }
    }
  }
}

export function apply(ctx: CordisContext, config: Config = {}): void {
  const routes = [
    config.deepseekRoute ?? "pi-ling-deepseek",
    config.anthropicRoute ?? "pi-ling-anthropic",
  ];
  ctx.llm.registerAdapter(routes, new PiLingLlmAdapter(routes));
}
