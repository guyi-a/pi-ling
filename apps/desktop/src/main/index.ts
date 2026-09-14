import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { promises as fs } from "node:fs";
import { dirname, join, resolve } from "node:path";

function bootLog(message: string): void {
  if (process.env.NODE_ENV === "test") return;
  try {
    const dir = join(process.env.APPDATA ?? "", "@pi-ling", "desktop");
    mkdirSync(dir, { recursive: true });
    appendFileSync(
      join(dir, "boot.log"),
      `${new Date().toISOString()} ${message}\n`,
      { flag: "a" },
    );
  } catch {
    // ignore
  }
}

bootLog("main module loading");
import { fileURLToPath } from "node:url";

import type {
  AgentPromptAccepted,
  AgentPromptRequest,
  AgentStatus,
  AppInfo,
  AppTheme,
  LlmConfigSaveRequest,
  LlmConfigSnapshot,
  LlmModelOption,
  ApprovalMode,
  ComposerMode,
  ApprovalDecisionRequest,
  AskUserAnswer,
  ChangedFile,
  QuestionAnswerRequest,
  CreateSessionRequest,
  FileDiff,
  PromptAttachment,
  SessionArchiveResult,
  SessionActivation,
  SessionSummary,
  StreamFrameEnvelope,
  TerminalStartRequest,
  TerminalStartResult,
  TimelineSnapshot,
  WorkspaceListEntry,
  WorkspaceSummary,
  WorkspaceTreeResult,
  WorkspaceFileContent,
  WorkspaceWriteResult,
  DiffFileContents,
} from "@pi-ling/contracts";
import { CodexRuntimeAdapter } from "@pi-ling/codex-runtime";
import { DshRuntimeAdapter } from "@pi-ling/dsh-runtime";

import {
  cancelEvalRun,
  clearEvalTaskOverride,
  compareEvalRuns,
  getEvalSnapshot,
  getEvalTaskDetail,
  getEvalWorkbenchState,
  openEvalCatalog,
  runEvalSuite,
  runEvalTask,
  saveEvalTaskOverride,
  validateEvalCatalog,
  getEvalRunResults,
} from "./eval-handlers.js";
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

import {
  importAttachmentImageFromPath,
  saveAttachmentImage,
} from "./attachment-store.js";
import { resolveCodexLaunchConfig } from "./codex-launch-config.js";
import { resolveDshLaunchConfig } from "./dsh-launch-config.js";
import {
  getLlmConfigSnapshot,
  hydrateLlmConfigFromDisk,
  initLlmConfigStore,
  saveLlmConfig,
} from "./llm-config-store.js";
import { listPiAiModels } from "./llm-model-registry.js";
import { SessionStore } from "./session-store/session-store.js";
import { SessionSupervisor } from "./session-supervisor.js";
import { TerminalSupervisor } from "./terminal-supervisor.js";
import { buildWorkspaceTree, readFileContent, writeFileContent } from "./workspace-fs.js";
import { importFilesToWorkspaceRoot } from "./workspace-upload.js";
import {
  ensureRuntimeConfig,
  loadApplicationEnv,
  resolveDevRepoRoot,
} from "./app-env.js";
import { applyLoginShellEnvFix } from "./login-shell-env.js";
import {
  registerWorkspaceProtocolHandlers,
  registerWorkspaceProtocolSchemes,
} from "./workspace-protocol.js";

bootLog("registering workspace protocol schemes");
registerWorkspaceProtocolSchemes();
bootLog("workspace protocol schemes registered");

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_INFO_CHANNEL = "app:get-info";
const APP_OPEN_EXTERNAL_CHANNEL = "app:open-external";
const LLM_CONFIG_GET_CHANNEL = "llm-config:get";
const LLM_CONFIG_SAVE_CHANNEL = "llm-config:save";
const LLM_CONFIG_LIST_MODELS_CHANNEL = "llm-config:list-models";
const AGENT_STATUS_CHANNEL = "agent:get-status";
const AGENT_SEND_CHANNEL = "agent:send";
const AGENT_CANCEL_CHANNEL = "agent:cancel";
const TIMELINE_EVENT_CHANNEL = "timeline:event";
const TASK_UPDATED_CHANNEL = "task:updated";
const TIMELINE_FRAME_CHANNEL = "timeline:frame";
const TIMELINE_SNAPSHOT_CHANNEL = "timeline:snapshot";
const WORKSPACE_SELECT_CHANNEL = "workspace:select";
const APPROVAL_RESOLVE_CHANNEL = "approval:resolve";
const QUESTION_RESOLVE_CHANNEL = "question:resolve";
const CHANGES_GET_CHANNEL = "changes:get";
const DIFF_GET_CHANNEL = "diff:get";
const WORKSPACE_TREE_CHANNEL = "workspace:tree";
const WORKSPACE_READ_FILE_CHANNEL = "workspace:read-file";
const WORKSPACE_WRITE_FILE_CHANNEL = "workspace:write-file";
const WORKSPACE_DIFF_CONTENTS_CHANNEL = "workspace:diff-contents";
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
const SESSION_COMPOSER_MODE_CHANNEL = "session:composer-mode";
const SESSION_RUNTIME_CHANNEL = "session:runtime";
const THEME_SET_CHANNEL = "theme:set";
const TERMINAL_START_CHANNEL = "terminal:start";
const TERMINAL_INPUT_CHANNEL = "terminal:input";
const TERMINAL_RESIZE_CHANNEL = "terminal:resize";
const TERMINAL_KILL_CHANNEL = "terminal:kill";
const ATTACHMENT_SAVE_IMAGE_CHANNEL = "attachment:save-image";
const EVAL_SNAPSHOT_CHANNEL = "eval:snapshot";
const EVAL_GET_STATE_CHANNEL = "eval:get-state";
const EVAL_RUN_SUITE_CHANNEL = "eval:run-suite";
const EVAL_RUN_TASK_CHANNEL = "eval:run-task";
const EVAL_CANCEL_CHANNEL = "eval:cancel";
const EVAL_COMPARE_CHANNEL = "eval:compare";
const EVAL_TASK_DETAIL_CHANNEL = "eval:get-task-detail";
const EVAL_SAVE_OVERRIDE_CHANNEL = "eval:save-task-override";
const EVAL_CLEAR_OVERRIDE_CHANNEL = "eval:clear-task-override";
const EVAL_OPEN_CATALOG_CHANNEL = "eval:open-catalog";
const EVAL_VALIDATE_CATALOG_CHANNEL = "eval:validate-catalog";
const EVAL_RUN_RESULTS_CHANNEL = "eval:get-run-results";
const ATTACHMENT_PICK_IMAGES_CHANNEL = "attachment:pick-images";
const WORKSPACE_UPLOAD_FILES_CHANNEL = "workspace:upload-files";

const windowThemeColors: Record<
  AppTheme,
  { background: string; symbols: string }
> = {
  dark: { background: "#181818", symbols: "#CCCCCC" },
  light: { background: "#F3F3F3", symbols: "#333333" },
};

if (!app.isPackaged) {
  loadApplicationEnv(__dirname);
}

let sessionStore: SessionStore | undefined;
let dshRuntime: DshRuntimeAdapter | undefined;
let codexRuntime: CodexRuntimeAdapter | undefined;

function resolveRepoRootForRuntimes(): string | undefined {
  return app.isPackaged
    ? process.env["PI_LING_REPO_ROOT"]?.trim()
      ? resolve(process.env["PI_LING_REPO_ROOT"])
      : undefined
    : resolveDevRepoRoot(__dirname);
}

async function initializeSidecarRuntimes(userDataPath: string): Promise<void> {
  const repoRoot = resolveRepoRootForRuntimes();
  const dshLaunch = resolveDshLaunchConfig(
    process.env,
    userDataPath,
    undefined,
    repoRoot,
  );
  if (dshLaunch.enabled && "options" in dshLaunch) {
    startupLog(
      `DSH launch command=${dshLaunch.options.command} bin=${dshLaunch.options.dshBin}`,
    );
    dshRuntime = new DshRuntimeAdapter(dshLaunch.options);
  } else if (dshLaunch.enabled) {
    console.warn(`DSH Runtime disabled: ${dshLaunch.reason}`);
  }
  const codexLaunch = resolveCodexLaunchConfig(
    process.env,
    userDataPath,
    repoRoot,
  );
  if (codexLaunch.enabled && "options" in codexLaunch) {
    codexRuntime = new CodexRuntimeAdapter(codexLaunch.options);
  } else if (codexLaunch.enabled) {
    console.warn(`Codex Runtime disabled: ${codexLaunch.reason}`);
  }
}

async function reloadSidecarRuntimes(): Promise<void> {
  await dshRuntime?.dispose();
  await codexRuntime?.dispose();
  dshRuntime = undefined;
  codexRuntime = undefined;
  await initializeSidecarRuntimes(app.getPath("userData"));
}
const terminalSupervisor = new TerminalSupervisor();
const supervisors = new Map<
  number,
  { supervisor: SessionSupervisor; ready: Promise<void> }
>();

function parseAttachments(value: unknown): PromptAttachment[] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("attachments" in value) ||
    !Array.isArray(value.attachments)
  ) {
    return [];
  }
  const attachments: PromptAttachment[] = [];
  for (const item of value.attachments) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof item.id !== "string" ||
      item.id.length === 0 ||
      typeof item.relativePath !== "string" ||
      item.relativePath.length === 0 ||
      typeof item.name !== "string" ||
      item.name.length === 0 ||
      typeof item.mediaType !== "string" ||
      item.mediaType.length === 0
    ) {
      continue;
    }
    attachments.push({
      id: item.id,
      relativePath: item.relativePath,
      name: item.name,
      mediaType: item.mediaType,
    });
  }
  return attachments;
}

function parsePromptRequest(value: unknown): AgentPromptRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("requestId" in value) ||
    typeof value.requestId !== "string" ||
    value.requestId.length === 0 ||
    !("prompt" in value) ||
    typeof value.prompt !== "string"
  ) {
    throw new Error("Invalid model prompt request");
  }
  const prompt = value.prompt.trim();
  const attachments = parseAttachments(value);
  if (!prompt && attachments.length === 0) {
    throw new Error("Invalid model prompt request");
  }
  return {
    requestId: value.requestId,
    prompt,
    ...(attachments.length > 0 ? { attachments } : {}),
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

function parseQuestionAnswer(value: unknown): QuestionAnswerRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("callId" in value) ||
    typeof value.callId !== "string" ||
    !("answers" in value) ||
    !Array.isArray(value.answers)
  ) {
    throw new Error("Invalid question answer");
  }
  const answers = value.answers.map((entry): AskUserAnswer => {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("id" in entry) ||
      typeof entry.id !== "string" ||
      !("selected" in entry) ||
      !Array.isArray(entry.selected) ||
      !entry.selected.every((item) => typeof item === "string")
    ) {
      throw new Error("Invalid question answer entry");
    }
    return {
      id: entry.id,
      selected: [...entry.selected],
      ...("custom" in entry && typeof entry.custom === "string"
        ? { custom: entry.custom }
        : {}),
    };
  });
  return { callId: value.callId, answers };
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
    (value.runtimeKind === "native" ||
      value.runtimeKind === "dsh" ||
      value.runtimeKind === "codex")
      ? { runtimeKind: value.runtimeKind }
      : {}),
  };
}

function parseTerminalStartRequest(value: unknown): TerminalStartRequest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("cwd" in value) ||
    typeof value.cwd !== "string" ||
    !value.cwd.trim() ||
    !("cols" in value) ||
    typeof value.cols !== "number" ||
    !("rows" in value) ||
    typeof value.rows !== "number"
  ) {
    throw new Error("Invalid terminal start request");
  }
  return {
    cwd: value.cwd.trim(),
    cols: value.cols,
    rows: value.rows,
  };
}

function parseTerminalInput(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new Error("Invalid terminal input");
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
    codexRuntime,
    (event) => {
      if (!webContents.isDestroyed()) {
        webContents.send(TASK_UPDATED_CHANNEL, event);
      }
    },
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

function resolveWindowIcon(): string | undefined {
  const packagedIcon = join(process.resourcesPath, "icon.png");
  if (app.isPackaged && existsSync(packagedIcon)) {
    return packagedIcon;
  }
  const devIcon = join(__dirname, "../../assets/icon-source.png");
  return existsSync(devIcon) ? devIcon : undefined;
}

function createWindow(): BrowserWindow {
  const iconPath = resolveWindowIcon();
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 620,
    show: false,
    backgroundColor: windowThemeColors.dark.background,
    title: "pi-ling",
    ...(iconPath ? { icon: iconPath } : {}),
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
    window.maximize();
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

/** 只放行 http/https；其他协议（file:、javascript: 等）一律拒绝。 */
ipcMain.handle(
  APP_OPEN_EXTERNAL_CHANNEL,
  async (_event, url: unknown): Promise<boolean> => {
    if (typeof url !== "string") return false;
    let parsed: URL;
    try {
      parsed = new URL(url.trim());
    } catch {
      return false;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return false;
    }
    await shell.openExternal(parsed.toString());
    return true;
  },
);

ipcMain.handle(
  LLM_CONFIG_GET_CHANNEL,
  async (): Promise<LlmConfigSnapshot> => getLlmConfigSnapshot(),
);

ipcMain.handle(
  LLM_CONFIG_LIST_MODELS_CHANNEL,
  async (_event, provider: unknown): Promise<LlmModelOption[]> =>
    typeof provider === "string" ? listPiAiModels(provider) : [],
);

ipcMain.handle(
  LLM_CONFIG_SAVE_CHANNEL,
  async (_event, input: unknown) => {
    const request = input as LlmConfigSaveRequest;
    const result = await saveLlmConfig(request);
    await reloadSidecarRuntimes();
    return result;
  },
);

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
      request.attachments,
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
      runtimeKind:
        runtimeKind === "dsh"
          ? "dsh"
          : runtimeKind === "codex"
            ? "codex"
            : "native",
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
  QUESTION_RESOLVE_CHANNEL,
  async (event, input: unknown): Promise<boolean> => {
    const request = parseQuestionAnswer(input);
    return (await getSupervisor(event.sender)).resolveQuestion(
      request.callId,
      request.answers,
    );
  },
);

function normalizeChangesSource(
  source: unknown,
): "uncommitted" | "staged" | "unstaged" | "agent" {
  // last-agent-turn 归到 agent（会话基线）；其余 git 作用域照传。
  return source === "uncommitted" ||
    source === "staged" ||
    source === "unstaged"
    ? source
    : "agent";
}

ipcMain.handle(
  CHANGES_GET_CHANNEL,
  async (event, source: unknown): Promise<ChangedFile[]> =>
    (await getSupervisor(event.sender)).changedFiles(
      normalizeChangesSource(source),
    ),
);

ipcMain.handle(
  DIFF_GET_CHANNEL,
  async (event, userPath: unknown, source: unknown): Promise<FileDiff | undefined> => {
    if (typeof userPath !== "string" || !userPath.trim()) {
      throw new Error("Invalid diff path");
    }
    return (await getSupervisor(event.sender)).diff(
      userPath,
      normalizeChangesSource(source),
    );
  },
);

function parseWorkspaceRoot(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Invalid workspace root");
  }
  return value.trim();
}

ipcMain.handle(
  WORKSPACE_TREE_CHANNEL,
  async (event, root: unknown): Promise<WorkspaceTreeResult> => {
    const resolvedRoot = parseWorkspaceRoot(root);
    return buildWorkspaceTree(resolvedRoot);
  },
);

ipcMain.handle(
  WORKSPACE_READ_FILE_CHANNEL,
  async (
    event,
    root: unknown,
    subpath: unknown,
  ): Promise<WorkspaceFileContent> => {
    const resolvedRoot = parseWorkspaceRoot(root);
    if (typeof subpath !== "string" || !subpath.trim()) {
      throw new Error("Invalid file path");
    }
    return readFileContent(resolvedRoot, subpath.trim());
  },
);

ipcMain.handle(
  WORKSPACE_WRITE_FILE_CHANNEL,
  async (
    event,
    root: unknown,
    subpath: unknown,
    content: unknown,
  ): Promise<WorkspaceWriteResult> => {
    const resolvedRoot = parseWorkspaceRoot(root);
    if (typeof subpath !== "string" || !subpath.trim()) {
      throw new Error("Invalid file path");
    }
    if (typeof content !== "string") {
      throw new Error("Invalid file content");
    }
    return writeFileContent(resolvedRoot, subpath.trim(), content);
  },
);

ipcMain.handle(
  WORKSPACE_DIFF_CONTENTS_CHANNEL,
  async (
    event,
    path: unknown,
    source: unknown,
  ): Promise<DiffFileContents | undefined> => {
    if (typeof path !== "string" || !path.trim()) {
      throw new Error("Invalid diff path");
    }
    return (await getSupervisor(event.sender)).diffFileContents(
      path.trim(),
      normalizeChangesSource(source),
    );
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
  SESSION_COMPOSER_MODE_CHANNEL,
  async (event, mode: unknown): Promise<SessionSummary> => {
    if (mode !== "plan" && mode !== "ask" && mode !== "agent") {
      throw new Error("Invalid composer mode");
    }
    return (await getSupervisor(event.sender)).setComposerMode(
      mode as ComposerMode,
    );
  },
);

ipcMain.handle(
  SESSION_RUNTIME_CHANNEL,
  async (event, runtimeKind: unknown): Promise<SessionActivation> => {
    if (
      runtimeKind !== "native" &&
      runtimeKind !== "dsh" &&
      runtimeKind !== "codex"
    ) {
      throw new Error("Invalid runtime");
    }
    try {
      return (await getSupervisor(event.sender)).switchRuntime(runtimeKind);
    } catch (error) {
      const detail =
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "Unknown runtime switch error";
      const runtimeDiagnostics =
        runtimeKind === "dsh"
          ? dshRuntime?.diagnostics?.trim()
          : runtimeKind === "codex"
            ? codexRuntime?.diagnostics?.trim()
            : undefined;
      startupLog(
        `switchRuntime(${runtimeKind}) failed: ${detail}${
          runtimeDiagnostics ? `\n${runtimeDiagnostics.slice(-4000)}` : ""
        }`,
      );
      if (runtimeDiagnostics && !detail.includes(runtimeDiagnostics.slice(-200))) {
        throw new Error(`${detail}\n\n${runtimeDiagnostics.slice(-2000)}`, {
          cause: error,
        });
      }
      throw error;
    }
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

ipcMain.handle(
  TERMINAL_START_CHANNEL,
  async (event, request: unknown): Promise<TerminalStartResult> =>
    terminalSupervisor.start(event.sender, parseTerminalStartRequest(request)),
);

ipcMain.handle(
  TERMINAL_INPUT_CHANNEL,
  (event, sessionId: unknown, data: unknown): void => {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new Error("Invalid terminal session");
    }
    terminalSupervisor.input(
      event.sender.id,
      sessionId,
      parseTerminalInput(data),
    );
  },
);

ipcMain.handle(
  TERMINAL_RESIZE_CHANNEL,
  (
    event,
    sessionId: unknown,
    cols: unknown,
    rows: unknown,
  ): void => {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new Error("Invalid terminal session");
    }
    if (typeof cols !== "number" || typeof rows !== "number") {
      throw new Error("Invalid terminal dimensions");
    }
    terminalSupervisor.resize(event.sender.id, sessionId, cols, rows);
  },
);

ipcMain.handle(
  TERMINAL_KILL_CHANNEL,
  (event, sessionId: unknown): void => {
    if (typeof sessionId !== "string" || sessionId.length === 0) {
      throw new Error("Invalid terminal session");
    }
    terminalSupervisor.kill(event.sender.id, sessionId);
  },
);

ipcMain.handle(
  ATTACHMENT_SAVE_IMAGE_CHANNEL,
  async (
    _event,
    workspaceRoot: unknown,
    bytes: unknown,
    mimeType: unknown,
    suggestedName: unknown,
  ) => {
    if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
      throw new Error("Workspace root is required");
    }
    if (!(bytes instanceof Uint8Array) && !Buffer.isBuffer(bytes)) {
      throw new Error("Invalid image bytes");
    }
    if (typeof mimeType !== "string" || !mimeType.startsWith("image/")) {
      throw new Error("Invalid image mime type");
    }
    return saveAttachmentImage({
      workspaceRoot,
      bytes: Buffer.from(bytes as Uint8Array),
      mimeType,
      ...(typeof suggestedName === "string" && suggestedName.trim()
        ? { suggestedName: suggestedName.trim() }
        : {}),
    });
  },
);

ipcMain.handle(
  ATTACHMENT_PICK_IMAGES_CHANNEL,
  async (event, workspaceRoot: unknown) => {
    if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
      throw new Error("Workspace root is required");
    }
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Select images",
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: "Images",
          extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp"],
        },
      ],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }
    const saved = [];
    for (const sourcePath of result.filePaths) {
      saved.push(
        await importAttachmentImageFromPath({
          workspaceRoot,
          sourcePath,
        }),
      );
    }
    return saved;
  },
);

ipcMain.handle(
  WORKSPACE_UPLOAD_FILES_CHANNEL,
  async (event, workspaceRoot: unknown) => {
    if (typeof workspaceRoot !== "string" || workspaceRoot.length === 0) {
      throw new Error("Workspace root is required");
    }
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options: Electron.OpenDialogOptions = {
      title: "Upload files to workspace",
      properties: ["openFile", "multiSelections"],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }
    return importFilesToWorkspaceRoot({
      workspaceRoot,
      sourcePaths: result.filePaths,
    });
  },
);

ipcMain.handle(
  EVAL_SNAPSHOT_CHANNEL,
  async (): Promise<Awaited<ReturnType<typeof getEvalSnapshot>>> =>
    getEvalSnapshot(),
);

ipcMain.handle(
  EVAL_GET_STATE_CHANNEL,
  async (event): Promise<Awaited<ReturnType<typeof getEvalWorkbenchState>>> =>
    getEvalWorkbenchState(event.sender),
);

ipcMain.handle(
  EVAL_RUN_SUITE_CHANNEL,
  async (event, request): Promise<Awaited<ReturnType<typeof runEvalSuite>>> =>
    runEvalSuite(event.sender, request),
);

ipcMain.handle(
  EVAL_RUN_TASK_CHANNEL,
  async (event, request): Promise<Awaited<ReturnType<typeof runEvalTask>>> =>
    runEvalTask(event.sender, request),
);

ipcMain.handle(
  EVAL_CANCEL_CHANNEL,
  async (event): Promise<boolean> => cancelEvalRun(event.sender),
);

ipcMain.handle(
  EVAL_COMPARE_CHANNEL,
  async (_event, request): Promise<Awaited<ReturnType<typeof compareEvalRuns>>> =>
    compareEvalRuns(request),
);

ipcMain.handle(
  EVAL_TASK_DETAIL_CHANNEL,
  async (_event, taskId: string): Promise<Awaited<ReturnType<typeof getEvalTaskDetail>>> =>
    getEvalTaskDetail(taskId),
);

ipcMain.handle(
  EVAL_SAVE_OVERRIDE_CHANNEL,
  async (_event, request): Promise<Awaited<ReturnType<typeof saveEvalTaskOverride>>> =>
    saveEvalTaskOverride(request),
);

ipcMain.handle(
  EVAL_CLEAR_OVERRIDE_CHANNEL,
  async (_event, taskId: string): Promise<Awaited<ReturnType<typeof clearEvalTaskOverride>>> =>
    clearEvalTaskOverride(taskId),
);

ipcMain.handle(
  EVAL_OPEN_CATALOG_CHANNEL,
  async (): Promise<boolean> => openEvalCatalog(),
);

ipcMain.handle(
  EVAL_VALIDATE_CATALOG_CHANNEL,
  async (): Promise<Awaited<ReturnType<typeof validateEvalCatalog>>> =>
    validateEvalCatalog(),
);

ipcMain.handle(
  EVAL_RUN_RESULTS_CHANNEL,
  async (
    _event,
    experiment: string,
    variant: string,
  ): Promise<Awaited<ReturnType<typeof getEvalRunResults>>> =>
    getEvalRunResults(experiment, variant),
);

function startupLog(message: string): void {
  if (!app.isPackaged) return;
  try {
    const logDir = app.getPath("userData");
    mkdirSync(logDir, { recursive: true });
    appendFileSync(
      join(logDir, "startup.log"),
      `${new Date().toISOString()} ${message}\n`,
      { flag: "a" },
    );
  } catch {
    // ignore logging failures
  }
}

function reportStartupFailure(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error("pi-ling startup failed:", message);
  startupLog(`startup failed: ${message}`);
  if (app.isPackaged) {
    dialog.showErrorBox("pi-ling 启动失败", message);
  }
}

void app.whenReady().then(async () => {
  try {
    startupLog("app ready");
    registerWorkspaceProtocolHandlers();
    Menu.setApplicationMenu(null);

    if (app.isPackaged) {
      await applyLoginShellEnvFix();
      startupLog("login shell env applied");
      if (!(await ensureRuntimeConfig())) {
        startupLog("runtime config missing");
        app.quit();
        return;
      }
      loadApplicationEnv(__dirname);
      startupLog("env loaded");
    }

    const userDataPath = app.getPath("userData");
    initLlmConfigStore(userDataPath);
    await hydrateLlmConfigFromDisk();
    startupLog("llm config loaded");
    process.env.PI_LING_EVAL_DATA_DIR = join(userDataPath, "coding-eval");
    const fsExtHookCandidates = app.isPackaged
      ? [
          join(
            process.resourcesPath,
            "app.asar.unpacked/out/main/fs-ext-hook.js",
          ),
          join(__dirname, "fs-ext-hook.js"),
        ]
      : [
          join(__dirname, "fs-ext-hook.js"),
          join(
            resolveDevRepoRoot(__dirname),
            "packages/dsh-runtime/dist/fs-ext-hook.js",
          ),
        ];
    for (const candidate of fsExtHookCandidates) {
      if (existsSync(candidate)) {
        process.env.PI_LING_DSH_FS_EXT_HOOK = candidate;
        break;
      }
    }
    const sessionImportCandidates = app.isPackaged
      ? [
          join(
            process.resourcesPath,
            "app.asar.unpacked/out/main/dsh-transcript/dsh-session-import.js",
          ),
          join(__dirname, "dsh-transcript/dsh-session-import.js"),
        ]
      : [
          join(__dirname, "dsh-transcript/dsh-session-import.js"),
          join(
            resolveDevRepoRoot(__dirname),
            "packages/dsh-transcript/dist/dsh-session-import.js",
          ),
        ];
    for (const candidate of sessionImportCandidates) {
      if (existsSync(candidate)) {
        process.env.PI_LING_DSH_SESSION_IMPORT = candidate;
        break;
      }
    }
    const approvalPolicyCandidates = app.isPackaged
      ? [
          join(
            process.resourcesPath,
            "app.asar.unpacked/out/main/dsh-approval-policy.js",
          ),
          join(__dirname, "dsh-approval-policy.js"),
        ]
      : [
          join(__dirname, "dsh-approval-policy.js"),
          join(
            resolveDevRepoRoot(__dirname),
            "packages/dsh-runtime/dist/dsh-approval-policy.js",
          ),
        ];
    for (const candidate of approvalPolicyCandidates) {
      if (existsSync(candidate)) {
        process.env.PI_LING_DSH_APPROVAL_POLICY = candidate;
        break;
      }
    }
    await initializeSidecarRuntimes(userDataPath);
    sessionStore = new SessionStore(
      join(app.getPath("userData"), "pi-ling.db"),
    );
    sessionStore.reconcile();
    startupLog("session store ready");
    createWindow();
    startupLog("window created");
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
      }
    });
  } catch (error) {
    reportStartupFailure(error);
    app.quit();
  }
});

app.on("window-all-closed", () => {
  for (const entry of supervisors.values()) {
    void entry.supervisor.dispose();
  }
  supervisors.clear();
  terminalSupervisor.disposeAll();
  void dshRuntime?.dispose();
  void codexRuntime?.dispose();
  if (process.platform !== "darwin") {
    app.quit();
  }
});
