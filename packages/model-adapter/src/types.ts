import type {
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  ModelThinkingLevel,
} from "@earendil-works/pi-ai";

export interface ModelSelection {
  provider: string;
  model: string;
}

export interface ModelDescriptor extends ModelSelection {
  name: string;
  api: string;
  reasoning: boolean;
  input: readonly ("text" | "image")[];
  contextWindow: number;
  maxTokens: number;
}

export interface StartModelStreamRequest {
  requestId?: string;
  selection: ModelSelection;
  context: Context;
  thinkingLevel?: ModelThinkingLevel;
  sessionId?: string;
}

export interface ModelStreamHandle {
  requestId: string;
  events: AssistantMessageEventStream;
  result(): Promise<AssistantMessage>;
  cancel(): void;
}
