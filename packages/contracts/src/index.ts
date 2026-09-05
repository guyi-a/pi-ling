export const IPC_CHANNELS = {
  appInfo: "app:get-info",
  agentStatus: "agent:get-status",
  agentSend: "agent:send",
  agentCancel: "agent:cancel",
  agentReset: "agent:reset",
  agentEvent: "agent:event",
} as const;

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface AgentStatus {
  provider: string;
  model: string;
  configured: boolean;
}

export interface AgentPromptRequest {
  requestId: string;
  prompt: string;
}

export interface AgentPromptAccepted {
  requestId: string;
}

export interface AgentUsage {
  input: number;
  output: number;
  reasoning?: number;
  totalTokens: number;
  cost: number;
}

export type AgentUiEvent =
  | { type: "agent_start" }
  | { type: "assistant_start" }
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | {
      type: "assistant_end";
      stopReason: string;
      usage: AgentUsage;
      error?: string;
    }
  | { type: "agent_end" };

export interface AgentEventEnvelope {
  requestId: string;
  event: AgentUiEvent;
}

export interface DesktopApi {
  getAppInfo(): Promise<AppInfo>;
  getAgentStatus(): Promise<AgentStatus>;
  sendPrompt(request: AgentPromptRequest): Promise<AgentPromptAccepted>;
  cancelPrompt(requestId: string): Promise<boolean>;
  resetAgent(): Promise<void>;
  onAgentEvent(listener: (event: AgentEventEnvelope) => void): () => void;
}
