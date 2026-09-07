import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  AgentPromptAccepted,
  AgentPromptRequest,
  AgentStatus,
  AppInfo,
  AppTheme,
  ApprovalMode,
  ApprovalDecisionRequest,
  ChangedFile,
  CreateSessionRequest,
  FileDiff,
  SessionArchiveResult,
  SessionActivation,
  SessionSummary,
  StreamFrameEnvelope,
  TimelineSnapshot,
  WorkspaceListEntry,
  WorkspaceSummary,
} from "@pi-ling/contracts";
import { DshRuntimeAdapter } from "@pi-ling/dsh-runtime";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  shell,
  type WebContents,
} from "electron";

import { resolveDshLaunchConfig } from "./dsh-launch-config.js";
import { SessionStore } from "./session-store/session-store.js";
import { SessionSupervisor } from "./session-supervisor.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
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

const windowThemeColors: Record<
  AppTheme,
  { background: string; symbols: string }
> = {
  dark: { background: "#181818", symbols: "#CCCCCC" },
  light: { background: "#F3F3F3", symbols: "#333333" },
};

try {
  process.loadEnvFile(join(__dirname, "../../../../.env"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    throw error;
  }
}

let sessionStore: SessionStore | undefined;
let dshRuntime: DshRuntimeAdapter | undefined;
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
    ...("sessionId" in value && typeof value.sessionId === "string"
      ? { sessionId: value.sessionId }
      : {}),
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
    !(
      ("workspaceId" in value &&
        typeof value.workspaceId === "string" &&
        value.workspaceId.trim()) ||
      ("workspaceRoot" in value &&
        typeof value.workspaceRoot === "string" &&
        value.workspaceRoot.trim())
    )
  ) {
    throw new Error("Invalid session request");
  }
  return {
    ...("workspaceId" in value &&
    typeof value.workspaceId === "string" &&
    value.workspaceId.trim()
      ? { workspaceId: value.workspaceId.trim() }
      : {}),
    ...("workspaceRoot" in value &&
    typeof value.workspaceRoot === "string" &&
    value.workspaceRoot.trim()
      ? { workspaceRoot: value.workspaceRoot.trim() }
      : {}),
    ...("title" in value && typeof value.title === "string"
      ? { title: value.title }
      : {}),
    ...("runtimeKind" in value &&
    (value.runtimeKind === "native" || value.runtimeKind === "dsh")
      ? { runtimeKind: value.runtimeKind }
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
  const supervisor = new SessionSupervisor(
    sessionStore,
    (envelope) => {
      if (!webContents.isDestroyed()) {
        webContents.send(TIMELINE_EVENT_CHANNEL, envelope);
      }
    },
    (frame) => {
      if (!webContents.isDestroyed()) {
        webContents.send(TIMELINE_FRAME_CHANNEL, frame);
      }
    },
    dshRuntime,
  );
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
    backgroundColor: windowThemeColors.dark.background,
    title: "pi-ling",
    ...(process.platform === "win32"
      ? {
          titleBarStyle: "hidden" as const,
          titleBarOverlay: {
            color: windowThemeColors.dark.background,
            symbolColor: windowThemeColors.dark.symbols,
            height: 30,
          },
        }
      : { titleBarStyle: "hiddenInset" as const }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once("ready-to-show", () => {
    window.show();
    const capturePath = process.env["PI_LING_CAPTURE_PATH"];
    if (capturePath) {
      setTimeout(() => {
        void window.webContents.capturePage().then(async (image) => {
          await fs.mkdir(dirname(capturePath), { recursive: true });
          await fs.writeFile(capturePath, image.toPNG());
          app.quit();
        });
      }, 800);
    }
  });
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());

  const fixture = process.env["PI_LING_UI_FIXTURE"];
  const fixtureTheme = process.env["PI_LING_UI_THEME"];
  const fixtureView = process.env["PI_LING_UI_VIEW"];
  const fixtureSidebar = process.env["PI_LING_UI_SIDEBAR"];
  const fixtureSidebarView = process.env["PI_LING_UI_SIDEBAR_VIEW"];
  if (process.env["ELECTRON_RENDERER_URL"]) {
    const url = new URL(process.env["ELECTRON_RENDERER_URL"]);
    if (fixture) url.searchParams.set("fixture", fixture);
    if (fixtureTheme === "dark" || fixtureTheme === "light") {
      url.searchParams.set("theme", fixtureTheme);
    }
    if (fixtureView === "settings") url.searchParams.set("view", fixtureView);
    if (fixtureSidebar === "collapsed") {
      url.searchParams.set("sidebar", fixtureSidebar);
    }
    if (fixtureSidebarView === "archived") {
      url.searchParams.set("sidebar-view", fixtureSidebarView);
    }
    void window.loadURL(url.toString());
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"), {
      ...((fixture ||
      fixtureTheme === "dark" ||
      fixtureTheme === "light" ||
      fixtureView === "settings" ||
      fixtureSidebar === "collapsed" ||
      fixtureSidebarView === "archived")
        ? {
            query: {
              ...(fixture ? { fixture } : {}),
              ...(fixtureTheme === "dark" || fixtureTheme === "light"
                ? { theme: fixtureTheme }
                : {}),
              ...(fixtureView === "settings" ? { view: fixtureView } : {}),
              ...(fixtureSidebar === "collapsed"
                ? { sidebar: fixtureSidebar }
                : {}),
              ...(fixtureSidebarView === "archived"
                ? { "sidebar-view": fixtureSidebarView }
                : {}),
            },
          }
        : {}),
    });
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
      request.sessionId,
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
  async (event, sessionId: unknown): Promise<TimelineSnapshot> =>
    (await getSupervisor(event.sender)).snapshot(
      typeof sessionId === "string" ? sessionId : undefined,
    ),
);

ipcMain.handle(
  WORKSPACE_SELECT_CHANNEL,
  async (
    event,
    runtimeKind: unknown,
  ): Promise<SessionActivation | undefined> => {
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
      runtimeKind: runtimeKind === "dsh" ? "dsh" : "native",
    });
  },
);

ipcMain.handle(
  WORKSPACES_LIST_CHANNEL,
  async (
    event,
    includeArchived: unknown,
  ): Promise<WorkspaceListEntry[]> =>
    (await getSupervisor(event.sender)).listWorkspaces(
      includeArchived === true,
    ),
);

ipcMain.handle(
  WORKSPACES_ADD_CHANNEL,
  async (event): Promise<WorkspaceSummary | undefined> => {
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Add repository",
      properties: ["openDirectory"],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    const root = result.filePaths[0];
    return result.canceled || !root
      ? undefined
      : (await getSupervisor(event.sender)).addWorkspace(root);
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
  SESSIONS_PIN_CHANNEL,
  async (
    event,
    sessionId: unknown,
    pinned: unknown,
  ): Promise<SessionSummary> => {
    if (typeof sessionId !== "string" || typeof pinned !== "boolean") {
      throw new Error("Invalid pin request");
    }
    return (await getSupervisor(event.sender)).setSessionPinned(
      sessionId,
      pinned,
    );
  },
);

ipcMain.handle(
  SESSIONS_ARCHIVE_CHANNEL,
  async (event, sessionId: unknown): Promise<SessionArchiveResult> => {
    if (typeof sessionId !== "string" || !sessionId) {
      throw new Error("Invalid session id");
    }
    return (await getSupervisor(event.sender)).archiveSession(sessionId);
  },
);

ipcMain.handle(
  SESSIONS_RESTORE_CHANNEL,
  async (event, sessionId: unknown): Promise<SessionSummary> => {
    if (typeof sessionId !== "string" || !sessionId) {
      throw new Error("Invalid session id");
    }
    return (await getSupervisor(event.sender)).restoreSession(sessionId);
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

ipcMain.handle(
  SESSION_RUNTIME_CHANNEL,
  async (event, runtimeKind: unknown): Promise<SessionActivation> => {
    if (runtimeKind !== "native" && runtimeKind !== "dsh") {
      throw new Error("Invalid runtime");
    }
    return (await getSupervisor(event.sender)).switchRuntime(runtimeKind);
  },
);

ipcMain.handle(
  THEME_SET_CHANNEL,
  (event, theme: unknown): void => {
    if (theme !== "dark" && theme !== "light") {
      throw new Error("Invalid theme");
    }
    const appTheme = theme as AppTheme;
    const colors = windowThemeColors[appTheme];
    nativeTheme.themeSource = appTheme;
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.setBackgroundColor(colors.background);
    if (process.platform === "win32") {
      window?.setTitleBarOverlay({
        color: colors.background,
        symbolColor: colors.symbols,
        height: 30,
      });
    }
  },
);

void app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  const dshLaunch = resolveDshLaunchConfig(
    process.env,
    app.getPath("userData"),
  );
  if (dshLaunch.enabled && "options" in dshLaunch) {
    dshRuntime = new DshRuntimeAdapter(dshLaunch.options);
  } else if (dshLaunch.enabled) {
    console.warn(`DSH Runtime disabled: ${dshLaunch.reason}`);
  }
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
  void dshRuntime?.dispose();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
