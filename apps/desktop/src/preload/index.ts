import type {
  ApprovalDecisionRequest,
  ApprovalMode,
  AgentPromptRequest,
  CreateSessionRequest,
  DesktopApi,
  TimelineEnvelope,
} from "@pi-ling/contracts";
import { contextBridge, ipcRenderer } from "electron";

const APP_INFO_CHANNEL = "app:get-info";
const AGENT_STATUS_CHANNEL = "agent:get-status";
const AGENT_SEND_CHANNEL = "agent:send";
const AGENT_CANCEL_CHANNEL = "agent:cancel";
const TIMELINE_EVENT_CHANNEL = "timeline:event";
const TIMELINE_SNAPSHOT_CHANNEL = "timeline:snapshot";
const WORKSPACE_SELECT_CHANNEL = "workspace:select";
const APPROVAL_RESOLVE_CHANNEL = "approval:resolve";
const CHANGES_GET_CHANNEL = "changes:get";
const DIFF_GET_CHANNEL = "diff:get";
const SESSIONS_LIST_CHANNEL = "sessions:list";
const SESSIONS_CREATE_CHANNEL = "sessions:create";
const SESSIONS_SWITCH_CHANNEL = "sessions:switch";
const SESSIONS_DELETE_CHANNEL = "sessions:delete";
const SESSION_APPROVAL_MODE_CHANNEL = "session:approval-mode";

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
  getAgentStatus: () => ipcRenderer.invoke(AGENT_STATUS_CHANNEL),
  sendPrompt: (request: AgentPromptRequest) =>
    ipcRenderer.invoke(AGENT_SEND_CHANNEL, request),
  cancelPrompt: (requestId: string) =>
    ipcRenderer.invoke(AGENT_CANCEL_CHANNEL, requestId),
  selectWorkspace: () => ipcRenderer.invoke(WORKSPACE_SELECT_CHANNEL),
  resolveApproval: (decision: ApprovalDecisionRequest) =>
    ipcRenderer.invoke(APPROVAL_RESOLVE_CHANNEL, decision),
  getChanges: () => ipcRenderer.invoke(CHANGES_GET_CHANNEL),
  getDiff: (path: string) => ipcRenderer.invoke(DIFF_GET_CHANNEL, path),
  getTimelineSnapshot: () => ipcRenderer.invoke(TIMELINE_SNAPSHOT_CHANNEL),
  listSessions: () => ipcRenderer.invoke(SESSIONS_LIST_CHANNEL),
  createSession: (request: CreateSessionRequest) =>
    ipcRenderer.invoke(SESSIONS_CREATE_CHANNEL, request),
  switchSession: (sessionId: string) =>
    ipcRenderer.invoke(SESSIONS_SWITCH_CHANNEL, sessionId),
  deleteSession: (sessionId: string) =>
    ipcRenderer.invoke(SESSIONS_DELETE_CHANNEL, sessionId),
  setApprovalMode: (mode: ApprovalMode) =>
    ipcRenderer.invoke(SESSION_APPROVAL_MODE_CHANNEL, mode),
  onTimelineEvent: (listener: (event: TimelineEnvelope) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: TimelineEnvelope,
    ) => listener(value);
    ipcRenderer.on(TIMELINE_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(TIMELINE_EVENT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld("piLing", desktopApi);
