export const IPC_CHANNELS = {
  appInfo: "app:get-info",
  agentStatus: "agent:get-status",
  agentSend: "agent:send",
  agentCancel: "agent:cancel",
  timelineEvent: "timeline:event",
  timelineFrame: "timeline:frame",
  timelineSnapshot: "timeline:snapshot",
  workspaceSelect: "workspace:select",
  approvalResolve: "approval:resolve",
  questionResolve: "question:resolve",
  changesGet: "changes:get",
  diffGet: "diff:get",
  workspaceTree: "workspace:tree",
  workspaceReadFile: "workspace:read-file",
  sessionsList: "sessions:list",
  sessionsCreate: "sessions:create",
  sessionsSwitch: "sessions:switch",
  sessionsDelete: "sessions:delete",
  sessionsPin: "sessions:pin",
  sessionsArchive: "sessions:archive",
  sessionsRestore: "sessions:restore",
  workspacesList: "workspaces:list",
  workspacesAdd: "workspaces:add",
  sessionApprovalMode: "session:approval-mode",
  sessionComposerMode: "session:composer-mode",
  sessionRuntime: "session:runtime",
  themeSet: "theme:set",
  terminalStart: "terminal:start",
  terminalInput: "terminal:input",
  terminalResize: "terminal:resize",
  terminalKill: "terminal:kill",
  terminalOutput: "terminal:output",
  terminalExit: "terminal:exit",
  attachmentSaveImage: "attachment:save-image",
  attachmentPickImages: "attachment:pick-images",
  taskUpdated: "task:updated",
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
  contextWindow?: number;
  configured: boolean;
  approvalMode: ApprovalMode;
  composerMode: ComposerMode;
  workspace?: WorkspaceInfo;
}

export interface PromptAttachment {
  id: string;
  relativePath: string;
  name: string;
  mediaType: string;
}

export interface SavedAttachmentImage {
  path: string;
  name: string;
  relativePath: string;
  mediaType: string;
}

export interface AgentPromptRequest {
  requestId: string;
  prompt: string;
  sessionId?: string;
  attachments?: PromptAttachment[];
  composerMode?: ComposerMode;
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

export interface WorkspaceSummary extends WorkspaceInfo {
  id: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt?: number;
}

export interface WorkspaceListEntry extends WorkspaceSummary {
  sessions: SessionSummary[];
}

export type SessionLifecycle =
  | "idle"
  | "running"
  | "awaiting_approval"
  | "awaiting_question"
  | "crashed";

export type ApprovalMode = "manual" | "accept-write" | "auto";
export type ComposerMode = "plan" | "ask" | "agent";
export type RuntimeKind = "native" | "dsh" | "claude";

export type SubagentType = "explore";
export type SubagentMode = "foreground" | "background";

export interface SubagentSpec {
  type: SubagentType;
  mode: SubagentMode;
  description: string;
  prompt: string;
}

export type BackgroundTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface BackgroundTask {
  id: string;
  parentSessionId: string;
  parentRunId: string;
  parentToolCallId: string;
  childSessionId?: string;
  status: BackgroundTaskStatus;
  description: string;
  summary?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  continuedAt?: number;
}

export interface TaskUpdatedEvent {
  sessionId: string;
  task: BackgroundTask;
}
export type AppTheme = "dark" | "light";
/** 变更面板的数据来源；agent=当前会话基线的改动（非 git），其余为 git 作用域 */
export type ChangesSource =
  | "agent"
  | "uncommitted"
  | "staged"
  | "unstaged"
  | "last-agent-turn";

export const SESSION_EVENT_SCHEMA_VERSION = 1;

export type CanonicalContentBlock =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string; signature?: string }
  | {
      type: "tool-call";
      toolCallId: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      type: "tool-result";
      toolCallId: string;
      content: string;
      isError: boolean;
    }
  | {
      type: "attachment";
      attachmentId: string;
      mediaType: string;
      name?: string;
    };

export interface CanonicalMessage {
  id: string;
  role: "user" | "assistant" | "tool";
  content: CanonicalContentBlock[];
  sourceRuntime: RuntimeKind;
  createdAt: number;
  rawPayload?: Record<string, unknown>;
}

export interface CanonicalToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CanonicalToolResult {
  toolCallId: string;
  content: string;
  isError: boolean;
  rawPayload?: Record<string, unknown>;
}

export type SessionEvent =
  | {
      kind: "run.started";
      userMessage: CanonicalMessage;
      continuation?: boolean;
    }
  | {
      kind: "run.ended";
      status: "completed" | "cancelled" | "error" | "crashed";
    }
  | { kind: "turn.started"; turn: number }
  | { kind: "turn.ended" }
  | { kind: "message.user.committed"; message: CanonicalMessage }
  | {
      kind: "message.assistant.committed";
      message: CanonicalMessage;
      stopReason: string;
      usage: AgentUsage;
      contextUsage?: { used: number; size: number };
      error?: string;
    }
  | { kind: "tool.call.committed"; toolCall: CanonicalToolCall }
  | { kind: "tool.execution.started"; toolCallId: string }
  | { kind: "tool.result.committed"; result: CanonicalToolResult }
  | {
      kind: "approval.requested";
      toolItemId: string;
      approval: ApprovalRequest;
    }
  | {
      kind: "approval.resolved";
      toolItemId: string;
      callId: string;
      approved: boolean;
    }
  | {
      kind: "question.requested";
      toolItemId: string;
      question: QuestionRequest;
    }
  | {
      kind: "question.answered";
      toolItemId: string;
      callId: string;
      answers: AskUserAnswer[];
    }
  | {
      kind: "changes.committed";
      callId: string;
      files: ChangedFile[];
    }
  | {
      kind: "usage.recorded";
      usage: AgentUsage;
      contextUsage?: { used: number; size: number };
    }
  | {
      kind: "compaction.applied";
      compactionId: string;
      throughMessageId: string;
      summary: CanonicalMessage;
      replacedMessageIds: string[];
      replacedCount: number;
      estimatedTokens?: number;
    }
  | {
      kind: "session.status.changed";
      lifecycle: SessionLifecycle;
    }
  | {
      kind: "subagent.spawned";
      parentToolCallId: string;
      childSessionId: string;
      childRunId: string;
      subagentType: SubagentType;
      description: string;
    }
  | {
      kind: "task.notified";
      taskId: string;
      status: BackgroundTaskStatus;
      description: string;
      summary?: string;
      error?: string;
    };

export interface SessionEventEnvelope {
  sessionId: string;
  seq: number;
  schemaVersion: number;
  runtimeKind: RuntimeKind;
  emittedAt: number;
  idempotencyKey?: string;
  runId?: string;
  turnId?: string;
  messageId?: string;
  toolCallId?: string;
  event: SessionEvent;
  rawPayload?: Record<string, unknown>;
}

export type StreamFrame =
  | {
      kind: "assistant.text.delta";
      delta: string;
    }
  | {
      kind: "assistant.reasoning.delta";
      delta: string;
    }
  | {
      kind: "tool.arguments.delta";
      delta: string;
    }
  | {
      kind: "tool.status";
      status: "requested" | "running";
    };

export interface StreamFrameEnvelope {
  sessionId: string;
  runId: string;
  frameSeq: number;
  emittedAt: number;
  turnId?: string;
  messageId?: string;
  toolCallId?: string;
  frame: StreamFrame;
}

export interface SessionSummary {
  id: string;
  workspaceId: string;
  title: string;
  workspace: WorkspaceInfo;
  lifecycle: SessionLifecycle;
  approvalMode: ApprovalMode;
  composerMode: ComposerMode;
  runtimeKind: RuntimeKind;
  runtimeVersion?: string;
  pinnedAt?: number;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSessionRequest {
  workspaceId?: string;
  workspaceRoot?: string;
  title?: string;
  runtimeKind?: RuntimeKind;
}

export interface SessionActivation {
  session: SessionSummary;
  status: AgentStatus;
  snapshot: TimelineSnapshot;
  bufferFrames: StreamFrameEnvelope[];
  backgroundTasks: BackgroundTask[];
  activationRevision: number;
}

export interface SessionArchiveResult {
  sessionId: string;
  activation?: SessionActivation;
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

export interface AskUserOption {
  label: string;
  description?: string;
}

export interface AskUserQuestion {
  id: string;
  question: string;
  header?: string;
  options?: AskUserOption[];
}

export interface AskUserAnswer {
  id: string;
  selected: string[];
  custom?: string;
}

export interface QuestionRequest {
  callId: string;
  questions: AskUserQuestion[];
}

export interface QuestionAnswerRequest {
  callId: string;
  answers: AskUserAnswer[];
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted";
  binary: boolean;
  sensitive: boolean;
  tooLarge: boolean;
  additions?: number;
  deletions?: number;
  /** 变更位于暂存区（index）还是工作区；Uncommitted 视图可能同时含两者 */
  staged?: boolean;
}

export interface FileDiff {
  path: string;
  patch: string;
  truncated: boolean;
}

export interface WorkspaceTreeNode {
  name: string;
  /** 相对工作区根目录的路径，用 "/" 分隔；目录以 "/" 结尾。 */
  path: string;
  kind: "file" | "dir";
  size?: number;
}

export interface WorkspaceTreeResult {
  workspaceRootName: string;
  entries: WorkspaceTreeNode[];
  /** 目录项数量超过上限，已截断。 */
  truncated?: boolean;
}

export type WorkspaceFileKind =
  | "markdown"
  | "text"
  | "image"
  | "binary"
  | "unsupported";

export type WorkspaceFileContent =
  | {
      kind: "markdown" | "text";
      path: string;
      name: string;
      content: string;
      size: number;
      truncated?: boolean;
    }
  | { kind: "image"; path: string; name: string; size: number }
  | { kind: "binary"; path: string; name: string; size: number }
  | { kind: "unsupported"; path: string; name: string; size: number }
  | { kind: "missing" }
  | { kind: "error"; message: string };

export interface TimelineUserAttachment {
  relativePath: string;
  name: string;
  mediaType: string;
}

export type TimelineEvent =
  | {
      type: "run_start";
      userItemId: string;
      prompt: string;
      continuation?: boolean;
      attachments?: TimelineUserAttachment[];
    }
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
      usage?: AgentUsage;
      contextUsage?: { used: number; size: number };
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
      type: "question_requested";
      turnId: string;
      itemId: string;
      toolItemId: string;
      question: QuestionRequest;
    }
  | {
      type: "question_answered";
      turnId: string;
      itemId: string;
      toolItemId: string;
      callId: string;
      answers: AskUserAnswer[];
    }
  | {
      type: "changes";
      turnId: string;
      itemId: string;
      callId: string;
      files: ChangedFile[];
    }
  | {
      type: "compaction_marker";
      itemId: string;
      compactionId: string;
      replacedCount: number;
      throughMessageId: string;
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

export interface TerminalStartRequest {
  cwd: string;
  cols: number;
  rows: number;
}

export interface TerminalStartResult {
  sessionId: string;
  cwd: string;
  shell: string;
}

export interface TerminalOutputEvent {
  sessionId: string;
  data: Uint8Array;
}

export interface TerminalExitEvent {
  sessionId: string;
  exitCode: number | null;
}

export interface EvalCatalogStats {
  total: number;
  enabled: number;
  disabled: number;
  baseline: number;
  judged: number;
}

export interface EvalLedgerSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
}

export interface EvalPanelSnapshot {
  stats: EvalCatalogStats;
  ledger?: EvalLedgerSummary;
  ledgerPath: string;
}

export interface EvalScoringPolicy {
  forbidden_paths: string[];
  max_changed_files: number;
  max_added_lines: number;
  max_deleted_lines: number;
}

export interface EvalJudgeSpec {
  type: "llm";
  target: string;
  rubric: string;
}

export interface EvalTaskView {
  id: string;
  title: string;
  description: string;
  difficulty?: string;
  enabled: boolean;
  baselineIncluded: boolean;
  hasJudge: boolean;
  promptPreview: string;
  hasLocalOverride: boolean;
}

export interface EvalTaskDetail extends EvalTaskView {
  prompt: string;
  fixtureFiles: string[];
  fixtureCommand: string;
  verify: { name: string; command: string }[];
  scoring: EvalScoringPolicy;
  judge?: EvalJudgeSpec;
}

export interface EvalSuiteRunSummary {
  experiment: string;
  variant: string;
  driver: string;
  runtime?: string;
  startedAt: string;
  finishedAt: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
}

export interface EvalRunResultView {
  taskId: string;
  title: string;
  status: "passed" | "failed" | "skipped" | "error";
  durationMs: number;
  verifyPassed: number;
  verifyTotal: number;
  violations: string[];
  toolCalls?: number;
  judgeScore?: number;
  judgeRationale?: string;
  judgeError?: string;
  error?: string;
  verifyDetails: {
    name: string;
    exitCode: number;
    stdout?: string;
    stderr?: string;
  }[];
}

export interface EvalLatestRun {
  experiment: string;
  variant: string;
  results: EvalRunResultView[];
}

export interface EvalActiveRun {
  runId: string;
  index: number;
  total: number;
  taskId: string;
  status: "running" | "cancelling";
}

export interface EvalWorkbenchState {
  stats: EvalCatalogStats;
  dataDir: string;
  ledgerPath: string;
  catalogPath: string;
  overridesPath: string;
  tasks: EvalTaskView[];
  runs: EvalSuiteRunSummary[];
  latestRun?: EvalLatestRun;
  activeRun?: EvalActiveRun;
  suggestedCompare?: EvalCompareRequest;
}

export interface EvalRunSuiteRequest {
  driver: "reference" | "agent" | "noop";
  runtime: "native" | "dsh";
  scope: "baseline" | "full" | "selected";
  taskIds?: string[];
  variantLabel?: string;
  judgeMode?: "auto" | "on" | "off";
}

export interface EvalRunTaskRequest {
  taskId: string;
  driver: "reference" | "agent";
  runtime: "native" | "dsh";
  variantLabel?: string;
  judgeMode?: "auto" | "on" | "off";
}

export interface EvalRunAccepted {
  runId: string;
  experiment: string;
  variant: string;
}

export interface EvalSuiteProgressEvent {
  runId: string;
  phase: "task-start" | "task-done" | "suite-done" | "suite-error";
  index: number;
  total: number;
  taskId: string;
  result?: EvalRunResultView;
  error?: string;
}

export interface EvalCompareRequest {
  experiment: string;
  baselineVariant: string;
  candidateVariant: string;
  baselineRuntime?: string;
  candidateRuntime?: string;
}

export interface EvalMeanDelta {
  baseline: number;
  candidate: number;
  delta: number;
}

export interface EvalMetricsComparison {
  duration_ms: EvalMeanDelta;
  tool_calls: EvalMeanDelta;
  validation_calls: EvalMeanDelta;
  completion_gate_runs: EvalMeanDelta;
  approval_interrupts: EvalMeanDelta;
  judge_score: EvalMeanDelta;
  judge_pairs: number;
}

export interface EvalComparisonSummary {
  experiment: string;
  baseline: string;
  candidate: string;
  baseline_samples: number;
  candidate_samples: number;
  pairs: number;
  baseline_pass_rate: number;
  candidate_pass_rate: number;
  pass_rate_lift: number;
  metrics: EvalMetricsComparison;
  diagnostics: string[];
}

export interface EvalTaskComparisonRow {
  taskId: string;
  title: string;
  baselineStatus: "passed" | "failed" | "skipped" | "error" | "missing";
  candidateStatus: "passed" | "failed" | "skipped" | "error" | "missing";
  statusChanged: boolean;
  durationDeltaMs?: number;
  toolCallsDelta?: number;
  violations?: string[];
}

export interface EvalCompareView {
  summary: EvalComparisonSummary;
  taskRows: EvalTaskComparisonRow[];
}

export interface EvalTaskOverrideRequest {
  taskId: string;
  enabled?: boolean;
  prompt?: string;
  disabledReason?: string;
  baselineIncluded?: boolean;
}

export interface EvalValidateCatalogResult {
  valid: boolean;
  message: string;
  stats?: EvalCatalogStats;
}

export interface DesktopApi {
  getAppInfo(): Promise<AppInfo>;
  getAgentStatus(): Promise<AgentStatus>;
  sendPrompt(request: AgentPromptRequest): Promise<AgentPromptAccepted>;
  cancelPrompt(requestId: string): Promise<boolean>;
  selectWorkspace(runtimeKind?: RuntimeKind): Promise<SessionActivation | undefined>;
  resolveApproval(decision: ApprovalDecisionRequest): Promise<boolean>;
  resolveQuestion(request: QuestionAnswerRequest): Promise<boolean>;
  getChanges(source?: ChangesSource): Promise<ChangedFile[]>;
  getDiff(path: string, source?: ChangesSource): Promise<FileDiff | undefined>;
  workspaceTree(root: string): Promise<WorkspaceTreeResult>;
  readFile(root: string, subpath: string): Promise<WorkspaceFileContent>;
  getTimelineSnapshot(sessionId?: string): Promise<TimelineSnapshot>;
  listSessions(): Promise<SessionSummary[]>;
  listWorkspaces(includeArchived?: boolean): Promise<WorkspaceListEntry[]>;
  addWorkspace(): Promise<WorkspaceSummary | undefined>;
  createSession(request: CreateSessionRequest): Promise<SessionActivation>;
  switchSession(sessionId: string): Promise<SessionActivation>;
  deleteSession(sessionId: string): Promise<void>;
  setSessionPinned(
    sessionId: string,
    pinned: boolean,
  ): Promise<SessionSummary>;
  archiveSession(sessionId: string): Promise<SessionArchiveResult>;
  restoreSession(sessionId: string): Promise<SessionSummary>;
  setApprovalMode(mode: ApprovalMode): Promise<SessionSummary>;
  setComposerMode(mode: ComposerMode): Promise<SessionSummary>;
  switchRuntime(runtimeKind: RuntimeKind): Promise<SessionActivation>;
  setTheme(theme: AppTheme): Promise<void>;
  terminalStart(request: TerminalStartRequest): Promise<TerminalStartResult>;
  terminalInput(sessionId: string, data: Uint8Array): Promise<void>;
  terminalResize(sessionId: string, cols: number, rows: number): Promise<void>;
  terminalKill(sessionId: string): Promise<void>;
  saveAttachmentImage(
    workspaceRoot: string,
    bytes: Uint8Array,
    mimeType: string,
    suggestedName?: string,
  ): Promise<SavedAttachmentImage>;
  pickAttachmentImages(workspaceRoot: string): Promise<SavedAttachmentImage[]>;
  onTerminalOutput(listener: (event: TerminalOutputEvent) => void): () => void;
  onTerminalExit(listener: (event: TerminalExitEvent) => void): () => void;
  onTimelineEvent(listener: (event: TimelineEnvelope) => void): () => void;
  onStreamFrame(listener: (frame: StreamFrameEnvelope) => void): () => void;
  onTaskUpdated(listener: (event: TaskUpdatedEvent) => void): () => void;
  getEvalSnapshot(): Promise<EvalPanelSnapshot>;
  getEvalState(): Promise<EvalWorkbenchState>;
  runEvalSuite(request: EvalRunSuiteRequest): Promise<EvalRunAccepted>;
  runEvalTask(request: EvalRunTaskRequest): Promise<EvalRunAccepted>;
  cancelEvalRun(): Promise<boolean>;
  compareEvalRuns(request: EvalCompareRequest): Promise<EvalCompareView>;
  getEvalTaskDetail(taskId: string): Promise<EvalTaskDetail>;
  saveEvalTaskOverride(
    request: EvalTaskOverrideRequest,
  ): Promise<EvalWorkbenchState>;
  clearEvalTaskOverride(taskId: string): Promise<EvalWorkbenchState>;
  openEvalCatalog(): Promise<boolean>;
  validateEvalCatalog(): Promise<EvalValidateCatalogResult>;
  getEvalRunResults(
    experiment: string,
    variant: string,
  ): Promise<EvalRunResultView[]>;
  onEvalProgress(listener: (event: EvalSuiteProgressEvent) => void): () => void;
}
