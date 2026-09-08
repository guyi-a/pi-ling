import type {
  ApprovalDecisionRequest,
  ApprovalMode,
  AgentPromptRequest,
  AppTheme,
  ChangesSource,
  CreateSessionRequest,
  DesktopApi,
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
};

contextBridge.exposeInMainWorld("piLing", desktopApi);
