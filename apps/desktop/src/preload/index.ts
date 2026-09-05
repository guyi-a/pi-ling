import type {
  DesktopApi,
  ModelPromptRequest,
  RawModelEvent,
} from "@pi-ling/contracts";
import { contextBridge, ipcRenderer } from "electron";

const APP_INFO_CHANNEL = "app:get-info";
const MODEL_STATUS_CHANNEL = "model:get-status";
const MODEL_SEND_CHANNEL = "model:send";
const MODEL_CANCEL_CHANNEL = "model:cancel";
const MODEL_EVENT_CHANNEL = "model:event";

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
  getModelStatus: () => ipcRenderer.invoke(MODEL_STATUS_CHANNEL),
  sendPrompt: (request: ModelPromptRequest) =>
    ipcRenderer.invoke(MODEL_SEND_CHANNEL, request),
  cancelPrompt: (requestId: string) =>
    ipcRenderer.invoke(MODEL_CANCEL_CHANNEL, requestId),
  onModelEvent: (listener: (event: RawModelEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: RawModelEvent) => {
      listener(value);
    };
    ipcRenderer.on(MODEL_EVENT_CHANNEL, handler);
    return () => ipcRenderer.removeListener(MODEL_EVENT_CHANNEL, handler);
  },
};

contextBridge.exposeInMainWorld("piLing", desktopApi);
