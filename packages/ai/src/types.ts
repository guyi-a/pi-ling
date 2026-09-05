import type { TSchema } from "typebox";

export type Api = "openai-completions" | "anthropic-messages";
export type ProviderId = "deepseek" | "anthropic";
export type StopReason =
  | "pending"
  | "stop"
  | "length"
  | "toolUse"
  | "error"
  | "aborted";
export type ThinkingLevel = "off" | "low" | "medium" | "high";

export interface ModelCost {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Model {
  id: string;
  name: string;
  api: Api;
  provider: ProviderId;
  baseUrl: string;
  reasoning: boolean;
  input: readonly ("text" | "image")[];
  cost: ModelCost;
  contextWindow: number;
  maxTokens: number;
}

export interface TextContent {
  type: "text";
  text: string;
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  signature?: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ToolCall {
  type: "toolCall";
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

export interface UserMessage {
  role: "user";
  content: string | (TextContent | ImageContent)[];
  timestamp: number;
}

export interface AssistantMessage {
  role: "assistant";
  content: (TextContent | ThinkingContent | ToolCall)[];
  api: Api;
  provider: ProviderId;
  model: string;
  usage: Usage;
  stopReason: StopReason;
  errorMessage?: string;
  timestamp: number;
}

export interface ToolResultMessage {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: (TextContent | ImageContent)[];
  isError: boolean;
  timestamp: number;
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;
}

export interface Context {
  systemPrompt?: string;
  messages: Message[];
  tools?: Tool[];
}

export interface StreamOptions {
  apiKey?: string;
  signal?: AbortSignal;
  reasoning?: ThinkingLevel;
  maxTokens?: number;
  temperature?: number;
}

export type AssistantMessageEvent =
  | { type: "start"; partial: AssistantMessage }
  | {
      type: "text_start";
      contentIndex: number;
      partial: AssistantMessage;
    }
  | {
      type: "text_delta";
      contentIndex: number;
      delta: string;
      partial: AssistantMessage;
    }
  | {
      type: "text_end";
      contentIndex: number;
      content: string;
      partial: AssistantMessage;
    }
  | {
      type: "thinking_start";
      contentIndex: number;
      partial: AssistantMessage;
    }
  | {
      type: "thinking_delta";
      contentIndex: number;
      delta: string;
      partial: AssistantMessage;
    }
  | {
      type: "thinking_end";
      contentIndex: number;
      content: string;
      partial: AssistantMessage;
    }
  | {
      type: "toolcall_start";
      contentIndex: number;
      partial: AssistantMessage;
    }
  | {
      type: "toolcall_delta";
      contentIndex: number;
      delta: string;
      partial: AssistantMessage;
    }
  | {
      type: "toolcall_end";
      contentIndex: number;
      toolCall: ToolCall;
      partial: AssistantMessage;
    }
  | {
      type: "done";
      reason: Extract<StopReason, "stop" | "length" | "toolUse">;
      message: AssistantMessage;
    }
  | {
      type: "error";
      reason: Extract<StopReason, "error" | "aborted">;
      error: AssistantMessage;
    };
