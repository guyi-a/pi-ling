export type RuntimeKind = "native" | "dsh";

export interface RuntimeCapabilities {
  modelSwitching: boolean;
  partialStreaming: boolean;
  toolApproval: boolean;
  mcp: boolean;
  hooks: boolean;
  sandbox: boolean;
  subagents: boolean;
  resume: boolean;
  fork: boolean;
  fileCheckpoint: boolean;
}

export interface RuntimeSessionOptions {
  sessionId: string;
  workspaceRoot: string;
  provider?: string;
  model?: string;
  externalSessionId?: string;
}

export interface RuntimeSessionHandle {
  sessionId: string;
  externalSessionId: string;
}

export type RuntimeToolStatus =
  | "requested"
  | "running"
  | "completed"
  | "failed";

export interface RuntimePermissionOption {
  optionId: string;
  label: string;
  kind: "allow_once" | "allow_always" | "reject_once" | "reject_always";
}

export type RuntimeEvent =
  | { type: "run_start"; runId: string }
  | {
      type: "assistant_text";
      runId: string;
      delta: string;
    }
  | {
      type: "assistant_thought";
      runId: string;
      delta: string;
    }
  | {
      type: "tool";
      runId: string;
      callId: string;
      title: string;
      kind?: string;
      status: RuntimeToolStatus;
      input?: unknown;
      output?: string;
    }
  | {
      type: "permission";
      runId: string;
      permissionId: string;
      callId: string;
      title: string;
      toolKind?: string;
      input?: unknown;
      options: RuntimePermissionOption[];
    }
  | {
      type: "usage";
      runId: string;
      used: number;
      size: number;
    }
  | {
      type: "run_end";
      runId: string;
      status: "completed" | "cancelled" | "error";
      error?: string;
    }
  | {
      type: "runtime_error";
      error: string;
      exitCode?: number;
    };

export interface RuntimePermissionDecision {
  permissionId: string;
  optionId?: string;
  cancelled?: boolean;
}

export type RuntimeEventListener = (
  event: RuntimeEvent,
) => void | Promise<void>;

export interface RuntimeAdapter {
  readonly kind: RuntimeKind;
  readonly capabilities: RuntimeCapabilities;
  initialize(): Promise<void>;
  createSession(options: RuntimeSessionOptions): Promise<RuntimeSessionHandle>;
  resumeSession(options: RuntimeSessionOptions): Promise<RuntimeSessionHandle>;
  send(sessionId: string, runId: string, prompt: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  resolvePermission(decision: RuntimePermissionDecision): Promise<boolean>;
  closeSession(sessionId: string): Promise<void>;
  subscribe(listener: RuntimeEventListener): () => void;
  dispose(): Promise<void>;
}
