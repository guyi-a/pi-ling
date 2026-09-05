import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  ApprovalDecisionRequest,
  AgentPromptAccepted,
  AgentPromptRequest,
  AgentStatus,
  AppInfo,
  ChangedFile,
  FileDiff,
  TimelineSnapshot,
  WorkspaceInfo,
} from "@pi-ling/contracts";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type WebContents,
} from "electron";

import { PiAgentSession } from "./pi-agent-session.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_INFO_CHANNEL = "app:get-info";
const AGENT_STATUS_CHANNEL = "agent:get-status";
const AGENT_SEND_CHANNEL = "agent:send";
const AGENT_CANCEL_CHANNEL = "agent:cancel";
const AGENT_RESET_CHANNEL = "agent:reset";
const TIMELINE_EVENT_CHANNEL = "timeline:event";
const TIMELINE_SNAPSHOT_CHANNEL = "timeline:snapshot";
const WORKSPACE_SELECT_CHANNEL = "workspace:select";
const APPROVAL_RESOLVE_CHANNEL = "approval:resolve";
const CHANGES_GET_CHANNEL = "changes:get";
const DIFF_GET_CHANNEL = "diff:get";

try {
  process.loadEnvFile(join(__dirname, "../../../../.env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

const agentSessions = new Map<number, PiAgentSession>();

function parsePromptRequest(value: unknown): AgentPromptRequest {
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

function parseApprovalDecision(value: unknown): ApprovalDecisionRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("callId" in value) ||
    typeof value.callId !== "string" ||
    !("approved" in value) ||
    typeof value.approved !== "boolean" ||
    !("effectDigest" in value) ||
    typeof value.effectDigest !== "string"
  ) {
    throw new Error("Invalid approval decision");
  }
  return {
    callId: value.callId,
    approved: value.approved,
    effectDigest: value.effectDigest,
    ...("reason" in value && typeof value.reason === "string"
      ? { reason: value.reason }
      : {}),
  };
}

function getAgentSession(webContents: WebContents): PiAgentSession {
  const existing = agentSessions.get(webContents.id);
  if (existing) {
    return existing;
  }

  const session = new PiAgentSession((envelope) => {
    if (!webContents.isDestroyed()) {
      webContents.send(TIMELINE_EVENT_CHANNEL, envelope);
    }
  });
  agentSessions.set(webContents.id, session);
  webContents.once("destroyed", () => {
    session.dispose();
    agentSessions.delete(webContents.id);
  });
  return session;
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
  AGENT_STATUS_CHANNEL,
  (event): AgentStatus => getAgentSession(event.sender).status,
);

ipcMain.handle(
  AGENT_SEND_CHANNEL,
  (event, input: unknown): AgentPromptAccepted => {
    const request = parsePromptRequest(input);
    getAgentSession(event.sender).startPrompt(request.requestId, request.prompt);
    return { requestId: request.requestId };
  },
);

ipcMain.handle(
  AGENT_CANCEL_CHANNEL,
  (event, requestId: unknown): boolean => {
    if (typeof requestId !== "string") {
      return false;
    }
    return getAgentSession(event.sender).cancel(requestId);
  },
);

ipcMain.handle(AGENT_RESET_CHANNEL, async (event): Promise<void> => {
  await getAgentSession(event.sender).reset();
});

ipcMain.handle(
  TIMELINE_SNAPSHOT_CHANNEL,
  (event): TimelineSnapshot => getAgentSession(event.sender).snapshot(),
);

ipcMain.handle(
  WORKSPACE_SELECT_CHANNEL,
  async (event): Promise<WorkspaceInfo | undefined> => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Select coding workspace",
      properties: ["openDirectory"],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    const root = result.filePaths[0];
    if (result.canceled || !root) {
      return undefined;
    }
    return getAgentSession(event.sender).setWorkspace(root);
  },
);

ipcMain.handle(
  APPROVAL_RESOLVE_CHANNEL,
  (event, input: unknown): boolean => {
    const decision = parseApprovalDecision(input);
    return getAgentSession(event.sender).resolveApproval(
      decision.callId,
      decision,
    );
  },
);

ipcMain.handle(
  CHANGES_GET_CHANNEL,
  (event): Promise<ChangedFile[]> =>
    getAgentSession(event.sender).changedFiles(),
);

ipcMain.handle(
  DIFF_GET_CHANNEL,
  (event, userPath: unknown): Promise<FileDiff | undefined> => {
    if (typeof userPath !== "string" || !userPath.trim()) {
      throw new Error("Invalid diff path");
    }
    return getAgentSession(event.sender).diff(userPath);
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
  for (const session of agentSessions.values()) {
    session.dispose();
  }
  agentSessions.clear();

  if (process.platform !== "darwin") {
    app.quit();
  }
});
