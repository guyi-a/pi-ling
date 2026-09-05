import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import type {
  AppInfo,
  ModelPromptAccepted,
  ModelPromptRequest,
  ModelStatus,
  RawModelEvent,
} from "@pi-ling/contracts";
import { app, BrowserWindow, ipcMain, shell } from "electron";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_INFO_CHANNEL = "app:get-info";
const MODEL_STATUS_CHANNEL = "model:get-status";
const MODEL_SEND_CHANNEL = "model:send";
const MODEL_CANCEL_CHANNEL = "model:cancel";
const MODEL_EVENT_CHANNEL = "model:event";
const MODEL_PROVIDER = "deepseek";
const MODEL_ID = "deepseek-v4-flash";

const models = createModels();
models.setProvider(deepseekProvider());

const activeRequests = new Map<
  string,
  { controller: AbortController; webContentsId: number }
>();

function rawEvent(requestId: string, event: unknown): RawModelEvent {
  return {
    requestId,
    json: JSON.stringify(event, null, 2),
  };
}

function parsePromptRequest(value: unknown): ModelPromptRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("requestId" in value) ||
    typeof value.requestId !== "string" ||
    value.requestId.length === 0 ||
    !("prompt" in value) ||
    typeof value.prompt !== "string" ||
    value.prompt.trim().length === 0
  ) {
    throw new Error("Invalid model prompt request");
  }
  return {
    requestId: value.requestId,
    prompt: value.prompt.trim(),
  };
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: "#0b0d12",
    title: "pi-ling",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => window.show());

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  if (process.env["ELECTRON_RENDERER_URL"]) {
    void window.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return window;
}

ipcMain.handle(APP_INFO_CHANNEL, (): AppInfo => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
}));

ipcMain.handle(
  MODEL_STATUS_CHANNEL,
  (): ModelStatus => ({
    provider: MODEL_PROVIDER,
    model: MODEL_ID,
    configured: Boolean(process.env["DEEPSEEK_API_KEY"]?.trim()),
  }),
);

ipcMain.handle(
  MODEL_SEND_CHANNEL,
  (event, input: unknown): ModelPromptAccepted => {
    const request = parsePromptRequest(input);
    if (activeRequests.has(request.requestId)) {
      throw new Error(`Model request already exists: ${request.requestId}`);
    }

    const model = models.getModel(MODEL_PROVIDER, MODEL_ID);
    if (!model) {
      throw new Error(`Model is unavailable: ${MODEL_PROVIDER}/${MODEL_ID}`);
    }

    const controller = new AbortController();
    activeRequests.set(request.requestId, {
      controller,
      webContentsId: event.sender.id,
    });

    void (async () => {
      try {
        const stream = models.streamSimple(
          model,
          {
            messages: [
              {
                role: "user",
                content: request.prompt,
                timestamp: Date.now(),
              },
            ],
          },
          {
            signal: controller.signal,
            sessionId: request.requestId,
            reasoning: "high",
          },
        );

        for await (const modelEvent of stream) {
          if (!event.sender.isDestroyed()) {
            event.sender.send(
              MODEL_EVENT_CHANNEL,
              rawEvent(request.requestId, modelEvent),
            );
          }
        }
      } catch (error) {
        if (!event.sender.isDestroyed()) {
          event.sender.send(
            MODEL_EVENT_CHANNEL,
            rawEvent(request.requestId, {
              type: "ipc_error",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      } finally {
        activeRequests.delete(request.requestId);
      }
    })();

    return { requestId: request.requestId };
  },
);

ipcMain.handle(
  MODEL_CANCEL_CHANNEL,
  (event, requestId: unknown): boolean => {
    if (typeof requestId !== "string") {
      return false;
    }
    const request = activeRequests.get(requestId);
    if (!request || request.webContentsId !== event.sender.id) {
      return false;
    }
    request.controller.abort();
    return true;
  },
);

void app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  for (const request of activeRequests.values()) {
    request.controller.abort();
  }
  activeRequests.clear();

  if (process.platform !== "darwin") {
    app.quit();
  }
});
