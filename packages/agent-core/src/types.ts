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

export type AgentEvent =
  | { type: "agent_start" }
  | { type: "agent_end"; messages: Message[] }
  | { type: "turn_start"; turn: number }
  | {
      type: "turn_end";
      turn: number;
      message: AssistantMessage;
      toolResults: ToolResultMessage[];
    }
  | { type: "message_start"; message: Message }
  | {
      type: "message_update";
      message: AssistantMessage;
      assistantMessageEvent: AssistantMessageEvent;
    }
  | { type: "message_end"; message: Message }
  | {
      type: "tool_execution_start";
      toolCall: ToolCall;
    }
  | {
      type: "tool_execution_end";
      toolCall: ToolCall;
      result: ToolResultMessage;
    };

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
  maxTurns?: number;
}
