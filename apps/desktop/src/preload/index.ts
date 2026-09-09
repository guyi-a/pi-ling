import type {
  ApprovalDecisionRequest,
  ApprovalMode,
  AgentPromptRequest,
  AppTheme,
  ChangesSource,
  CreateSessionRequest,
  DesktopApi,
  EvalCompareRequest,
  EvalPanelSnapshot,
  EvalRunSuiteRequest,
  EvalRunTaskRequest,
  EvalSuiteProgressEvent,
  EvalTaskOverrideRequest,
  EvalWorkbenchState,
  RuntimeKind,
  StreamFrameEnvelope,
  TerminalExitEvent,
  TerminalOutputEvent,
  TerminalStartRequest,
  TimelineEnvelope,
  WorkspaceFileContent,
  WorkspaceTreeResult,
} from "@pi-ling/contracts";
import { contextBridge, ipcRenderer } from "electron";

const APP_INFO_CHANNEL = "app:get-info";
const AGENT_STATUS_CHANNEL = "agent:get-status";
const AGENT_SEND_CHANNEL = "agent:send";
const AGENT_CANCEL_CHANNEL = "agent:cancel";
const TIMELINE_EVENT_CHANNEL = "timeline:event";
const TIMELINE_FRAME_CHANNEL = "timeline:frame";
const TIMELINE_SNAPSHOT_CHANNEL = "timeline:snapshot";
const WORKSPACE_SELECT_CHANNEL = "workspace:select";
const APPROVAL_RESOLVE_CHANNEL = "approval:resolve";
const CHANGES_GET_CHANNEL = "changes:get";
const DIFF_GET_CHANNEL = "diff:get";
const WORKSPACE_TREE_CHANNEL = "workspace:tree";
const WORKSPACE_READ_FILE_CHANNEL = "workspace:read-file";
const SESSIONS_LIST_CHANNEL = "sessions:list";
const SESSIONS_CREATE_CHANNEL = "sessions:create";
const SESSIONS_SWITCH_CHANNEL = "sessions:switch";
const SESSIONS_DELETE_CHANNEL = "sessions:delete";
const SESSIONS_PIN_CHANNEL = "sessions:pin";
const SESSIONS_ARCHIVE_CHANNEL = "sessions:archive";
const SESSIONS_RESTORE_CHANNEL = "sessions:restore";
const WORKSPACES_LIST_CHANNEL = "workspaces:list";
const WORKSPACES_ADD_CHANNEL = "workspaces:add";
const SESSION_APPROVAL_MODE_CHANNEL = "session:approval-mode";
const SESSION_RUNTIME_CHANNEL = "session:runtime";
const THEME_SET_CHANNEL = "theme:set";
const TERMINAL_START_CHANNEL = "terminal:start";
const TERMINAL_INPUT_CHANNEL = "terminal:input";
const TERMINAL_RESIZE_CHANNEL = "terminal:resize";
const TERMINAL_KILL_CHANNEL = "terminal:kill";
const TERMINAL_OUTPUT_CHANNEL = "terminal:output";
const TERMINAL_EXIT_CHANNEL = "terminal:exit";
const ATTACHMENT_SAVE_IMAGE_CHANNEL = "attachment:save-image";
const ATTACHMENT_PICK_IMAGES_CHANNEL = "attachment:pick-images";
const EVAL_SNAPSHOT_CHANNEL = "eval:snapshot";
const EVAL_GET_STATE_CHANNEL = "eval:get-state";
const EVAL_RUN_SUITE_CHANNEL = "eval:run-suite";
const EVAL_RUN_TASK_CHANNEL = "eval:run-task";
const EVAL_CANCEL_CHANNEL = "eval:cancel";
const EVAL_COMPARE_CHANNEL = "eval:compare";
const EVAL_TASK_DETAIL_CHANNEL = "eval:get-task-detail";
const EVAL_SAVE_OVERRIDE_CHANNEL = "eval:save-task-override";
const EVAL_CLEAR_OVERRIDE_CHANNEL = "eval:clear-task-override";
const EVAL_OPEN_CATALOG_CHANNEL = "eval:open-catalog";
const EVAL_VALIDATE_CATALOG_CHANNEL = "eval:validate-catalog";
const EVAL_PROGRESS_CHANNEL = "eval:progress";
const EVAL_RUN_RESULTS_CHANNEL = "eval:get-run-results";

function toUint8Array(data: unknown): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof data === "string") return new TextEncoder().encode(data);
  return new Uint8Array();
}

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
  getAgentStatus: () => ipcRenderer.invoke(AGENT_STATUS_CHANNEL),
  sendPrompt: (request: AgentPromptRequest) =>
    ipcRenderer.invoke(AGENT_SEND_CHANNEL, request),
  cancelPrompt: (requestId: string) =>
    ipcRenderer.invoke(AGENT_CANCEL_CHANNEL, requestId),
  selectWorkspace: (runtimeKind?: RuntimeKind) =>
    ipcRenderer.invoke(WORKSPACE_SELECT_CHANNEL, runtimeKind),
  resolveApproval: (decision: ApprovalDecisionRequest) =>
    ipcRenderer.invoke(APPROVAL_RESOLVE_CHANNEL, decision),
  getChanges: (source?: ChangesSource) =>
    ipcRenderer.invoke(CHANGES_GET_CHANNEL, source),
  getDiff: (path: string, source?: ChangesSource) =>
    ipcRenderer.invoke(DIFF_GET_CHANNEL, path, source),
  workspaceTree: (root: string) =>
    ipcRenderer.invoke(WORKSPACE_TREE_CHANNEL, root),
  readFile: (root: string, subpath: string) =>
    ipcRenderer.invoke(WORKSPACE_READ_FILE_CHANNEL, root, subpath),
  getTimelineSnapshot: (sessionId?: string) =>
    ipcRenderer.invoke(TIMELINE_SNAPSHOT_CHANNEL, sessionId),
  listSessions: () => ipcRenderer.invoke(SESSIONS_LIST_CHANNEL),
  listWorkspaces: (includeArchived?: boolean) =>
    ipcRenderer.invoke(WORKSPACES_LIST_CHANNEL, includeArchived),
  addWorkspace: () => ipcRenderer.invoke(WORKSPACES_ADD_CHANNEL),
  createSession: (request: CreateSessionRequest) =>
    ipcRenderer.invoke(SESSIONS_CREATE_CHANNEL, request),
  switchSession: (sessionId: string) =>
    ipcRenderer.invoke(SESSIONS_SWITCH_CHANNEL, sessionId),
  deleteSession: (sessionId: string) =>
    ipcRenderer.invoke(SESSIONS_DELETE_CHANNEL, sessionId),
  setSessionPinned: (sessionId: string, pinned: boolean) =>
    ipcRenderer.invoke(SESSIONS_PIN_CHANNEL, sessionId, pinned),
  archiveSession: (sessionId: string) =>
    ipcRenderer.invoke(SESSIONS_ARCHIVE_CHANNEL, sessionId),
  restoreSession: (sessionId: string) =>
    ipcRenderer.invoke(SESSIONS_RESTORE_CHANNEL, sessionId),
  setApprovalMode: (mode: ApprovalMode) =>
    ipcRenderer.invoke(SESSION_APPROVAL_MODE_CHANNEL, mode),
  switchRuntime: (runtimeKind: RuntimeKind) =>
    ipcRenderer.invoke(SESSION_RUNTIME_CHANNEL, runtimeKind),
  setTheme: (theme: AppTheme) => ipcRenderer.invoke(THEME_SET_CHANNEL, theme),
  terminalStart: (request: TerminalStartRequest) =>
    ipcRenderer.invoke(TERMINAL_START_CHANNEL, request),
  terminalInput: (sessionId: string, data: Uint8Array) =>
    ipcRenderer.invoke(TERMINAL_INPUT_CHANNEL, sessionId, data),
  terminalResize: (sessionId: string, cols: number, rows: number) =>
    ipcRenderer.invoke(TERMINAL_RESIZE_CHANNEL, sessionId, cols, rows),
  terminalKill: (sessionId: string) =>
    ipcRenderer.invoke(TERMINAL_KILL_CHANNEL, sessionId),
  saveAttachmentImage: (
    workspaceRoot: string,
    bytes: Uint8Array,
    mimeType: string,
    suggestedName?: string,
  ) =>
    ipcRenderer.invoke(
      ATTACHMENT_SAVE_IMAGE_CHANNEL,
      workspaceRoot,
      bytes,
      mimeType,
      suggestedName,
    ),
  pickAttachmentImages: (workspaceRoot: string) =>
    ipcRenderer.invoke(ATTACHMENT_PICK_IMAGES_CHANNEL, workspaceRoot),
  onTerminalOutput: (listener: (event: TerminalOutputEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: TerminalOutputEvent,
    ) =>
      listener({
        sessionId: value.sessionId,
        data: toUint8Array(value.data),
      });
    ipcRenderer.on(TERMINAL_OUTPUT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(TERMINAL_OUTPUT_CHANNEL, handler);
  },
  onTerminalExit: (listener: (event: TerminalExitEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: TerminalExitEvent,
    ) => listener(value);
    ipcRenderer.on(TERMINAL_EXIT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(TERMINAL_EXIT_CHANNEL, handler);
  },
  onTimelineEvent: (listener: (event: TimelineEnvelope) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: TimelineEnvelope,
    ) => listener(value);
    ipcRenderer.on(TIMELINE_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(TIMELINE_EVENT_CHANNEL, handler);
  },
  onStreamFrame: (listener: (frame: StreamFrameEnvelope) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: StreamFrameEnvelope,
    ) => listener(value);
    ipcRenderer.on(TIMELINE_FRAME_CHANNEL, handler);
    return () => ipcRenderer.removeListener(TIMELINE_FRAME_CHANNEL, handler);
  },
  getEvalSnapshot: (): Promise<EvalPanelSnapshot> =>
    ipcRenderer.invoke(EVAL_SNAPSHOT_CHANNEL),
  getEvalState: (): Promise<EvalWorkbenchState> =>
    ipcRenderer.invoke(EVAL_GET_STATE_CHANNEL),
  runEvalSuite: (request: EvalRunSuiteRequest) =>
    ipcRenderer.invoke(EVAL_RUN_SUITE_CHANNEL, request),
  runEvalTask: (request: EvalRunTaskRequest) =>
    ipcRenderer.invoke(EVAL_RUN_TASK_CHANNEL, request),
  cancelEvalRun: (): Promise<boolean> =>
    ipcRenderer.invoke(EVAL_CANCEL_CHANNEL),
  compareEvalRuns: (request: EvalCompareRequest) =>
    ipcRenderer.invoke(EVAL_COMPARE_CHANNEL, request),
  getEvalTaskDetail: (taskId: string) =>
    ipcRenderer.invoke(EVAL_TASK_DETAIL_CHANNEL, taskId),
  saveEvalTaskOverride: (request: EvalTaskOverrideRequest) =>
    ipcRenderer.invoke(EVAL_SAVE_OVERRIDE_CHANNEL, request),
  clearEvalTaskOverride: (taskId: string) =>
    ipcRenderer.invoke(EVAL_CLEAR_OVERRIDE_CHANNEL, taskId),
  openEvalCatalog: (): Promise<boolean> =>
    ipcRenderer.invoke(EVAL_OPEN_CATALOG_CHANNEL),
  validateEvalCatalog: () =>
    ipcRenderer.invoke(EVAL_VALIDATE_CATALOG_CHANNEL),
  getEvalRunResults: (experiment: string, variant: string) =>
    ipcRenderer.invoke(EVAL_RUN_RESULTS_CHANNEL, experiment, variant),
  onEvalProgress: (listener: (event: EvalSuiteProgressEvent) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: EvalSuiteProgressEvent,
    ) => listener(value);
    ipcRenderer.on(EVAL_PROGRESS_CHANNEL, handler);
    return () => ipcRenderer.removeListener(EVAL_PROGRESS_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld("piLing", desktopApi);
