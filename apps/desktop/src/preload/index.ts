import type { DesktopApi } from "@pi-ling/contracts";
import { contextBridge, ipcRenderer } from "electron";

const APP_INFO_CHANNEL = "app:get-info";

const desktopApi: DesktopApi = {
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
};

contextBridge.exposeInMainWorld("piLing", desktopApi);
