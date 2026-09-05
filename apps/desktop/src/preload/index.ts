import type {
  AgentEventEnvelope,
  AgentPromptRequest,
  DesktopApi,
} from "@pi-ling/contracts";
import { contextBridge, ipcRenderer } from "electron";

const APP_INFO_CHANNEL = "app:get-info";
const AGENT_STATUS_CHANNEL = "agent:get-status";
const AGENT_SEND_CHANNEL = "agent:send";
const AGENT_CANCEL_CHANNEL = "agent:cancel";
const AGENT_RESET_CHANNEL = "agent:reset";
const AGENT_EVENT_CHANNEL = "agent:event";

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
  getAgentStatus: () => ipcRenderer.invoke(AGENT_STATUS_CHANNEL),
  sendPrompt: (request: AgentPromptRequest) =>
    ipcRenderer.invoke(AGENT_SEND_CHANNEL, request),
  cancelPrompt: (requestId: string) =>
    ipcRenderer.invoke(AGENT_CANCEL_CHANNEL, requestId),
  resetAgent: () => ipcRenderer.invoke(AGENT_RESET_CHANNEL),
  onAgentEvent: (listener: (event: AgentEventEnvelope) => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: AgentEventEnvelope,
    ) => listener(value);
    ipcRenderer.on(AGENT_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(AGENT_EVENT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld("piLing", desktopApi);
