export const IPC_CHANNELS = {
  appInfo: "app:get-info",
  agentStatus: "agent:get-status",
  agentSend: "agent:send",
  agentCancel: "agent:cancel",
  agentReset: "agent:reset",
  agentEvent: "agent:event",
  workspaceSelect: "workspace:select",
  approvalResolve: "approval:resolve",
  changesGet: "changes:get",
  diffGet: "diff:get",
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
  workspace?: WorkspaceInfo;
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

export interface WorkspaceInfo {
  root: string;
  name: string;
}

export interface ApprovalEffect {
  kind: string;
  [key: string]: unknown;
}

export interface ApprovalRequest {
  callId: string;
  tool: string;
  arguments: Record<string, unknown>;
  effect: ApprovalEffect;
  effectDigest: string;
  reason: string;
}

export interface ApprovalDecisionRequest {
  callId: string;
  approved: boolean;
  effectDigest: string;
  reason?: string;
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  binary: boolean;
  sensitive: boolean;
  tooLarge: boolean;
}

export interface FileDiff {
  path: string;
  patch: string;
  truncated: boolean;
}

export type AgentUiEvent =
  | { type: "agent_start" }
  | { type: "assistant_start" }
  | { type: "text_delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | {
      type: "tool_start";
      callId: string;
      tool: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "tool_end";
      callId: string;
      tool: string;
      isError: boolean;
      output: string;
    }
  | { type: "approval_requested"; approval: ApprovalRequest }
  | {
      type: "approval_resolved";
      callId: string;
      approved: boolean;
    }
  | { type: "changes"; files: ChangedFile[] }
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
  selectWorkspace(): Promise<WorkspaceInfo | undefined>;
  resolveApproval(decision: ApprovalDecisionRequest): Promise<boolean>;
  getChanges(): Promise<ChangedFile[]>;
  getDiff(path: string): Promise<FileDiff | undefined>;
  onAgentEvent(listener: (event: AgentEventEnvelope) => void): () => void;
}
