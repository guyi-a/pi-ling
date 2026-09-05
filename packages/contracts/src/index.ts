export const IPC_CHANNELS = {
  appInfo: "app:get-info",
  modelStatus: "model:get-status",
  modelSend: "model:send",
  modelCancel: "model:cancel",
  modelEvent: "model:event",
} as const;

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
}

export interface ModelStatus {
  provider: string;
  model: string;
  configured: boolean;
}

export interface ModelPromptRequest {
  requestId: string;
  prompt: string;
}

export interface ModelPromptAccepted {
  requestId: string;
}

export interface RawModelEvent {
  requestId: string;
  json: string;
}

export interface DesktopApi {
  getAppInfo(): Promise<AppInfo>;
  getModelStatus(): Promise<ModelStatus>;
  sendPrompt(request: ModelPromptRequest): Promise<ModelPromptAccepted>;
  cancelPrompt(requestId: string): Promise<boolean>;
  onModelEvent(listener: (event: RawModelEvent) => void): () => void;
}
