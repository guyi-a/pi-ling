import type {
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Message,
  Model,
  Static,
  ThinkingLevel,
  Tool,
  ToolCall,
  ToolResultMessage,
  TSchema,
} from "@pi-ling/ai";

export type StreamFunction = (
  model: Model,
  context: Context,
  options: {
    signal: AbortSignal;
    reasoning?: ThinkingLevel;
  },
) => AssistantMessageEventStream;

export interface AgentToolResult<TDetails = unknown> {
  content: ToolResultMessage["content"];
  details?: TDetails;
}

export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
> extends Tool<TParameters> {
  label: string;
  execute(
    toolCallId: string,
    arguments_: Static<TParameters>,
    signal: AbortSignal,
  ): Promise<AgentToolResult<TDetails>>;
}

export interface AgentState {
  systemPrompt: string;
  model: Model;
  thinkingLevel: ThinkingLevel;
  tools: AgentTool[];
  messages: Message[];
  readonly isStreaming: boolean;
  readonly errorMessage: string | undefined;
}

export interface BeforeToolCallContext {
  runId: string;
  turnId: string;
  toolCall: ToolCall;
  tool: AgentTool;
  arguments: unknown;
  context: Context;
}

export interface BeforeToolCallResult {
  allow: boolean;
  reason?: string;
}

export type BeforeToolCall = (
  context: BeforeToolCallContext,
  signal: AbortSignal,
) => BeforeToolCallResult | Promise<BeforeToolCallResult>;

export type AgentEvent = { runId: string } & (
  | { type: "agent_start" }
  | { type: "agent_end"; messages: Message[] }
  | { type: "turn_start"; turnId: string; turn: number }
  | {
      type: "turn_end";
      turnId: string;
      turn: number;
      message: AssistantMessage;
      toolResults: ToolResultMessage[];
    }
  | { type: "message_start"; turnId?: string; message: Message }
  | {
      type: "message_update";
      turnId: string;
      message: AssistantMessage;
      assistantMessageEvent: AssistantMessageEvent;
    }
  | { type: "message_end"; turnId?: string; message: Message }
  | {
      type: "tool_execution_start";
      turnId: string;
      toolCall: ToolCall;
    }
  | {
      type: "tool_execution_end";
      turnId: string;
      toolCall: ToolCall;
      result: ToolResultMessage;
    }
);

export type AgentEventListener = (
  event: AgentEvent,
  signal: AbortSignal,
) => void | Promise<void>;

export interface AgentOptions {
  initialState: {
    model: Model;
    systemPrompt?: string;
    thinkingLevel?: ThinkingLevel;
    tools?: AgentTool[];
    messages?: Message[];
  };
  streamFn: StreamFunction;
  beforeToolCall?: BeforeToolCall;
  maxTurns?: number;
}
