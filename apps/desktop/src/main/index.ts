import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentPromptAccepted,
  AgentPromptRequest,
  AgentStatus,
  AppInfo,
  ApprovalMode,
  ApprovalDecisionRequest,
  ChangedFile,
  CreateSessionRequest,
  FileDiff,
  SessionActivation,
  SessionSummary,
  TimelineSnapshot,
} from "@pi-ling/contracts";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type WebContents,
} from "electron";

import { SessionStore } from "./session-store/session-store.js";
import { SessionSupervisor } from "./session-supervisor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
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

try {
  process.loadEnvFile(join(__dirname, "../../../../.env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

let sessionStore: SessionStore | undefined;
const supervisors = new Map<
  number,
  { supervisor: SessionSupervisor; ready: Promise<void> }
>();

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

function parseCreateSession(value: unknown): CreateSessionRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("workspaceRoot" in value) ||
    typeof value.workspaceRoot !== "string" ||
    !value.workspaceRoot.trim()
  ) {
    throw new Error("Invalid session request");
  }
  return {
    workspaceRoot: value.workspaceRoot,
    ...("title" in value && typeof value.title === "string"
      ? { title: value.title }
      : {}),
  };
}

async function getSupervisor(
  webContents: WebContents,
): Promise<SessionSupervisor> {
  const existing = supervisors.get(webContents.id);
  if (existing) {
    await existing.ready;
    return existing.supervisor;
  }
  if (!sessionStore) {
    throw new Error("Session store is not ready");
  }
  const supervisor = new SessionSupervisor(sessionStore, (envelope) => {
    if (!webContents.isDestroyed()) {
      webContents.send(TIMELINE_EVENT_CHANNEL, envelope);
    }
  });
  const entry = { supervisor, ready: supervisor.initialize() };
  supervisors.set(webContents.id, entry);
  webContents.once("destroyed", () => {
    void supervisor.dispose();
    supervisors.delete(webContents.id);
  });
  await entry.ready;
  return supervisor;
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
  window.webContents.on("will-navigate", (event) => event.preventDefault());

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
  async (event): Promise<AgentStatus> =>
    (await getSupervisor(event.sender)).status,
);

ipcMain.handle(
  AGENT_SEND_CHANNEL,
  async (event, input: unknown): Promise<AgentPromptAccepted> => {
    const request = parsePromptRequest(input);
    (await getSupervisor(event.sender)).startPrompt(
      request.requestId,
      request.prompt,
    );
    return { requestId: request.requestId };
  },
);

ipcMain.handle(
  AGENT_CANCEL_CHANNEL,
  async (event, runId: unknown): Promise<boolean> =>
    typeof runId === "string"
      ? (await getSupervisor(event.sender)).cancel(runId)
      : false,
);

ipcMain.handle(
  TIMELINE_SNAPSHOT_CHANNEL,
  async (event): Promise<TimelineSnapshot> =>
    (await getSupervisor(event.sender)).snapshot(),
);

ipcMain.handle(
  WORKSPACE_SELECT_CHANNEL,
  async (event): Promise<SessionActivation | undefined> => {
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
    return (await getSupervisor(event.sender)).create({
      workspaceRoot: root,
    });
  },
);

ipcMain.handle(
  APPROVAL_RESOLVE_CHANNEL,
  async (event, input: unknown): Promise<boolean> => {
    const decision = parseApprovalDecision(input);
    return (await getSupervisor(event.sender)).resolveApproval(
      decision.callId,
      decision,
    );
  },
);

ipcMain.handle(
  CHANGES_GET_CHANNEL,
  async (event): Promise<ChangedFile[]> =>
    (await getSupervisor(event.sender)).changedFiles(),
);

ipcMain.handle(
  DIFF_GET_CHANNEL,
  async (event, userPath: unknown): Promise<FileDiff | undefined> => {
    if (typeof userPath !== "string" || !userPath.trim()) {
      throw new Error("Invalid diff path");
    }
    return (await getSupervisor(event.sender)).diff(userPath);
  },
);

ipcMain.handle(
  SESSIONS_LIST_CHANNEL,
  async (event): Promise<SessionSummary[]> =>
    (await getSupervisor(event.sender)).list(),
);

ipcMain.handle(
  SESSIONS_CREATE_CHANNEL,
  async (event, input: unknown): Promise<SessionActivation> =>
    (await getSupervisor(event.sender)).create(parseCreateSession(input)),
);

ipcMain.handle(
  SESSIONS_SWITCH_CHANNEL,
  async (event, sessionId: unknown): Promise<SessionActivation> => {
    if (typeof sessionId !== "string" || !sessionId) {
      throw new Error("Invalid session id");
    }
    return (await getSupervisor(event.sender)).activate(sessionId);
  },
);

ipcMain.handle(
  SESSIONS_DELETE_CHANNEL,
  async (event, sessionId: unknown): Promise<void> => {
    if (typeof sessionId !== "string" || !sessionId) {
      throw new Error("Invalid session id");
    }
    await (await getSupervisor(event.sender)).delete(sessionId);
  },
);

ipcMain.handle(
  SESSION_APPROVAL_MODE_CHANNEL,
  async (event, mode: unknown): Promise<SessionSummary> => {
    if (
      mode !== "manual" &&
      mode !== "accept-write" &&
      mode !== "auto"
    ) {
      throw new Error("Invalid approval mode");
    }
    return (await getSupervisor(event.sender)).setApprovalMode(
      mode as ApprovalMode,
    );
  },
);

void app.whenReady().then(() => {
  sessionStore = new SessionStore(
    join(app.getPath("userData"), "pi-ling.db"),
  );
  sessionStore.reconcile();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  for (const entry of supervisors.values()) {
    void entry.supervisor.dispose();
  }
  supervisors.clear();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
