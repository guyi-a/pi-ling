export type RuntimeKind = "native" | "dsh" | "claude";

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

export interface RuntimeSessionImportOptions {
  /** External (DSH) session id created by the import, or appended to in delta mode. */
  sessionId: string;
  workspaceRoot: string;
  provider?: string;
  model?: string;
  /**
   * Canonical message history projected by the caller. Opaque to the generic
   * runtime contract; the concrete DSH bridge projects it into SessionEvents.
   * In delta mode this is only the messages after the last synced watermark.
   */
  canonicalMessages: readonly unknown[];
  /**
   * Append a delta to an existing external session instead of creating fresh.
   * `startTurn` is the turn number the first delta message maps to.
   */
  appendToExternalSessionId?: string;
  startTurn?: number;
}

export interface RuntimeSessionImportResult {
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

export interface RuntimeContextUsage {
  used: number;
  size: number;
}

export type RuntimeEvent =
  | { type: "run_start"; sessionId: string; runId: string }
  | {
      type: "assistant_text";
      sessionId: string;
      runId: string;
      executionGroupId: string;
      delta: string;
      messageId?: string;
    }
  | {
      type: "assistant_thought";
      sessionId: string;
      runId: string;
      executionGroupId: string;
      delta: string;
      messageId?: string;
    }
  | {
      type: "tool";
      sessionId: string;
      runId: string;
      executionGroupId: string;
      callId: string;
      title: string;
      kind?: string;
      status: RuntimeToolStatus;
      input?: unknown;
      output?: string;
    }
  | {
      type: "permission";
      sessionId: string;
      runId: string;
      executionGroupId: string;
      permissionId: string;
      callId: string;
      title: string;
      toolKind?: string;
      input?: unknown;
      options: RuntimePermissionOption[];
    }
  | {
      type: "context_usage";
      sessionId: string;
      runId: string;
      used: number;
      size: number;
    }
  | {
      type: "run_end";
      sessionId: string;
      runId: string;
      status: "completed" | "cancelled" | "error";
      error?: string;
    }
  | {
      type: "runtime_error";
      sessionId?: string;
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
  /**
   * Import canonical history into a new external session. Optional: only
   * runtimes that support seeding history (currently DSH) implement it.
   */
  importSession?(
    options: RuntimeSessionImportOptions,
  ): Promise<RuntimeSessionImportResult>;
  send(sessionId: string, runId: string, prompt: string): Promise<void>;
  cancel(sessionId: string): Promise<void>;
  resolvePermission(decision: RuntimePermissionDecision): Promise<boolean>;
  closeSession(sessionId: string): Promise<void>;
  subscribe(listener: RuntimeEventListener): () => void;
  dispose(): Promise<void>;
}
