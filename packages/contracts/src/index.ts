export const IPC_CHANNELS = {
  appInfo: "app:get-info",
  agentStatus: "agent:get-status",
  agentSend: "agent:send",
  agentCancel: "agent:cancel",
  timelineEvent: "timeline:event",
  timelineSnapshot: "timeline:snapshot",
  workspaceSelect: "workspace:select",
  approvalResolve: "approval:resolve",
  changesGet: "changes:get",
  diffGet: "diff:get",
  sessionsList: "sessions:list",
  sessionsCreate: "sessions:create",
  sessionsSwitch: "sessions:switch",
  sessionsDelete: "sessions:delete",
  sessionApprovalMode: "session:approval-mode",
  sessionRuntime: "session:runtime",
} as const;

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface AgentStatus {
  sessionId?: string;
  runtimeKind: RuntimeKind;
  availableRuntimes: RuntimeKind[];
  provider: string;
  model: string;
  configured: boolean;
  approvalMode: ApprovalMode;
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

export type SessionLifecycle =
  | "idle"
  | "running"
  | "awaiting_approval"
  | "crashed";

export type ApprovalMode = "manual" | "accept-write" | "auto";
export type RuntimeKind = "native" | "dsh";

export interface SessionSummary {
  id: string;
  title: string;
  workspace: WorkspaceInfo;
  lifecycle: SessionLifecycle;
  approvalMode: ApprovalMode;
  runtimeKind: RuntimeKind;
  runtimeVersion?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSessionRequest {
  workspaceRoot: string;
  title?: string;
  runtimeKind?: RuntimeKind;
}

export interface SessionActivation {
  session: SessionSummary;
  status: AgentStatus;
  snapshot: TimelineSnapshot;
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

export type TimelineEvent =
  | { type: "run_start"; userItemId: string; prompt: string }
  | {
      type: "run_end";
      status: "completed" | "cancelled" | "error" | "crashed";
    }
  | { type: "turn_start"; turnId: string; turn: number }
  | { type: "turn_end"; turnId: string }
  | { type: "assistant_start"; turnId: string; itemId: string }
  | {
      type: "assistant_text_delta";
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "assistant_thinking_delta";
      turnId: string;
      itemId: string;
      delta: string;
    }
  | {
      type: "assistant_end";
      turnId: string;
      itemId: string;
      stopReason: string;
      usage: AgentUsage;
      error?: string;
    }
  | {
      type: "tool_requested";
      turnId: string;
      itemId: string;
      callId: string;
      tool: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "tool_start";
      turnId: string;
      itemId: string;
      callId: string;
      tool: string;
      arguments: Record<string, unknown>;
    }
  | {
      type: "tool_end";
      turnId: string;
      itemId: string;
      callId: string;
      tool: string;
      isError: boolean;
      output: string;
    }
  | {
      type: "approval_requested";
      turnId: string;
      itemId: string;
      toolItemId: string;
      approval: ApprovalRequest;
    }
  | {
      type: "approval_resolved";
      turnId: string;
      itemId: string;
      toolItemId: string;
      callId: string;
      approved: boolean;
    }
  | {
      type: "changes";
      turnId: string;
      itemId: string;
      callId: string;
      files: ChangedFile[];
    };

export interface TimelineEnvelope {
  sessionId: string;
  runId: string;
  seq: number;
  emittedAt: number;
  event: TimelineEvent;
}

export interface TimelineSnapshot {
  sessionId: string;
  lastSeq: number;
  events: TimelineEnvelope[];
}

export interface DesktopApi {
  getAppInfo(): Promise<AppInfo>;
  getAgentStatus(): Promise<AgentStatus>;
  sendPrompt(request: AgentPromptRequest): Promise<AgentPromptAccepted>;
  cancelPrompt(requestId: string): Promise<boolean>;
  selectWorkspace(runtimeKind?: RuntimeKind): Promise<SessionActivation | undefined>;
  resolveApproval(decision: ApprovalDecisionRequest): Promise<boolean>;
  getChanges(): Promise<ChangedFile[]>;
  getDiff(path: string): Promise<FileDiff | undefined>;
  getTimelineSnapshot(): Promise<TimelineSnapshot>;
  listSessions(): Promise<SessionSummary[]>;
  createSession(request: CreateSessionRequest): Promise<SessionActivation>;
  switchSession(sessionId: string): Promise<SessionActivation>;
  deleteSession(sessionId: string): Promise<void>;
  setApprovalMode(mode: ApprovalMode): Promise<SessionSummary>;
  switchRuntime(runtimeKind: RuntimeKind): Promise<SessionActivation>;
  onTimelineEvent(listener: (event: TimelineEnvelope) => void): () => void;
}
