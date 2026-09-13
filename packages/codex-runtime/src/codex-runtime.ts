import { randomUUID } from "node:crypto";

import type {
  RuntimeAdapter,
  RuntimeApprovalPolicy,
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimePermissionDecision,
  RuntimePermissionOption,
  RuntimeQuestionDecision,
  RuntimeSandboxMode,
  RuntimeSessionHandle,
  RuntimeSessionImportOptions,
  RuntimeSessionImportResult,
  RuntimeSessionOptions,
} from "@pi-ling/runtime-contracts";

import { CodexAppServerClient } from "./codex-app-server-client.js";
import { CodexAppServerTransport } from "./codex-app-server-transport.js";
import {
  refreshCodexWorkspaceSkills,
  syncCodexWorkspaceSkills,
} from "./codex-skills.js";
import type {
  CodexApprovalRequest,
  CodexDynamicToolCallRequest,
  CodexQuestionRequest,
  CodexThreadItem,
  JsonRpcNotification,
  JsonRpcRequest,
} from "./codex-app-server-types.js";
import { CODEX_DEFAULT_DEEPSEEK_MODEL } from "./codex-deepseek-config.js";
import { isMissingCodexRolloutError } from "./codex-rollout-errors.js";
import { PI_LING_CODEX_DYNAMIC_TOOLS } from "./codex-dynamic-tools.js";
import {
  codexToolInput,
  codexToolKind,
  codexToolOutput,
  codexToolTitle,
} from "./codex-tool-mapping.js";

export { CODEX_DEFAULT_DEEPSEEK_MODEL };

export interface CodexRuntimeOptions {
  codexHome: string;
  codexBin?: string;
  /** Test/embedding override; defaults to `app-server --stdio`. */
  appServerArgs?: string[];
  model?: string;
  env?: Record<string, string>;
  initializeTimeoutMs?: number;
  shutdownTimeoutMs?: number;
}

export interface CodexSessionOptions {
  sandboxMode?: RuntimeSandboxMode;
  approvalPolicy?: RuntimeApprovalPolicy;
  composerMode?: "plan" | "ask" | "agent";
}

interface LocalSession {
  externalSessionId: string;
  workspaceRoot: string;
  model: string;
  sandboxMode: RuntimeSandboxMode;
  approvalPolicy: RuntimeApprovalPolicy;
  composerMode: "plan" | "ask" | "agent";
  activeRunId: string | undefined;
  activeTurnId: string | undefined;
  silent: boolean;
}

interface PendingApproval {
  responseId: string | number;
  options: RuntimePermissionOption[];
}

interface PendingQuestion {
  responseId: string | number;
}

interface PendingRun {
  resolve: () => void;
  reject: (error: Error) => void;
}

const DEFAULT_SANDBOX_MODE: RuntimeSandboxMode = "workspace-write";
const DEFAULT_APPROVAL_POLICY: RuntimeApprovalPolicy = "on-request";

function executionGroupId(runId: string): string {
  return `${runId}:exec`;
}

function runtimeToolCallId(runId: string, itemId: string): string {
  return `${runId}:${itemId}`;
}

function childEnvironment(
  options: CodexRuntimeOptions,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  Object.assign(env, options.env ?? {});
  env["CODEX_HOME"] = options.codexHome;
  delete env["ELECTRON_RUN_AS_NODE"];
  return env;
}

function formatCanonicalImport(messages: readonly unknown[]): string {
  const lines = [
    "<pi-ling-canonical-history>",
    "Continue from the canonical conversation history below.",
  ];
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue;
    const role = Reflect.get(message, "role");
    const content = Reflect.get(message, "content");
    if (typeof role !== "string") continue;
    let text = "";
    if (typeof content === "string") {
      text = content;
    } else if (Array.isArray(content)) {
      text = content
        .map((block) => {
          if (typeof block !== "object" || block === null) return "";
          const type = Reflect.get(block, "type");
          if (type === "text" || type === "reasoning") {
            return String(Reflect.get(block, "text") ?? "");
          }
          if (type === "tool-call") {
            return `[tool ${String(Reflect.get(block, "name") ?? "")}: ${JSON.stringify(Reflect.get(block, "input") ?? {})}]`;
          }
          if (type === "tool-result") {
            return `[tool result: ${String(Reflect.get(block, "content") ?? "")}]`;
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
    if (text.trim()) lines.push(`${role.toUpperCase()}: ${text.trim()}`);
  }
  lines.push(
    "Acknowledge this history internally. Do not repeat it and do not call tools.",
    "</pi-ling-canonical-history>",
  );
  return lines.join("\n\n");
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

export class CodexRuntimeAdapter implements RuntimeAdapter {
  readonly kind = "codex" as const;
  readonly capabilities: RuntimeCapabilities = {
    modelSwitching: false,
    partialStreaming: true,
    toolApproval: true,
    mcp: true,
    hooks: false,
    sandbox: true,
    subagents: false,
    resume: true,
    fork: false,
    fileCheckpoint: false,
  };

  readonly #options: CodexRuntimeOptions;
  readonly #listeners = new Set<RuntimeEventListener>();
  readonly #sessions = new Map<string, LocalSession>();
  readonly #sessionByThread = new Map<string, string>();
  readonly #pendingApprovals = new Map<string, PendingApproval>();
  readonly #pendingQuestions = new Map<string, PendingQuestion>();
  readonly #pendingRuns = new Map<string, PendingRun>();
  readonly #deltaItems = new Set<string>();
  readonly #workspaceRoots = new Set<string>();
  #transport: CodexAppServerTransport | undefined;
  #client: CodexAppServerClient | undefined;
  #initializing: Promise<void> | undefined;
  #disposed = false;

  constructor(options: CodexRuntimeOptions) {
    this.#options = options;
  }

  get diagnostics(): string {
    return this.#client?.diagnostics ?? this.#transport?.diagnostics ?? "";
  }

  initialize(): Promise<void> {
    if (this.#disposed) {
      return Promise.reject(new Error("Codex runtime disposed"));
    }
    return (this.#initializing ??= this.#start().catch((error: unknown) => {
      this.#initializing = undefined;
      void this.#client?.dispose().catch(() => {});
      this.#client = undefined;
      this.#transport = undefined;
      throw error;
    }));
  }

  async #start(): Promise<void> {
    if (this.#client) return;
    if (!this.#options.codexBin) {
      throw new Error("Codex app-server requires a Codex executable");
    }
    const transport = new CodexAppServerTransport({
      codexBin: this.#options.codexBin,
      ...(this.#options.appServerArgs
        ? { args: this.#options.appServerArgs }
        : {}),
      env: childEnvironment(this.#options),
      ...(this.#options.initializeTimeoutMs
        ? { initializeTimeoutMs: this.#options.initializeTimeoutMs }
        : {}),
      ...(this.#options.shutdownTimeoutMs
        ? { shutdownTimeoutMs: this.#options.shutdownTimeoutMs }
        : {}),
    });
    const client = new CodexAppServerClient(transport);
    client.onNotification((notification) => {
      void this.#handleNotification(notification);
    });
    client.onServerRequest((request) => this.#handleServerRequest(request));
    try {
      await client.initialize();
    } catch (error) {
      await client.dispose().catch(() => {});
      throw new Error(
        `Codex app-server initialization failed${
          client.diagnostics ? `\n${client.diagnostics}` : ""
        }`,
        { cause: error },
      );
    }
    this.#transport = transport;
    this.#client = client;
  }

  getExternalSessionId(sessionId: string): string | undefined {
    return this.#sessions.get(sessionId)?.externalSessionId;
  }

  setSessionOptions(
    sessionId: string,
    options: CodexSessionOptions,
  ): void {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    if (options.sandboxMode) session.sandboxMode = options.sandboxMode;
    if (options.approvalPolicy) {
      session.approvalPolicy = options.approvalPolicy;
    }
    if (options.composerMode) session.composerMode = options.composerMode;
  }

  async createSession(
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSessionHandle> {
    const client = await this.#requireClient();
    const session = this.#localSession(options, "");
    const externalSessionId = await client.startThread(
      this.#configuration(session),
    );
    session.externalSessionId = externalSessionId;
    this.#attachSession(options.sessionId, session);
    await this.#syncWorkspaceSkills(session.workspaceRoot);
    return { sessionId: options.sessionId, externalSessionId };
  }

  async resumeSession(
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSessionHandle> {
    if (!options.externalSessionId) return this.createSession(options);
    try {
      const client = await this.#requireClient();
      const session = this.#localSession(options, options.externalSessionId);
      const externalSessionId = await client.resumeThread(
        options.externalSessionId,
        this.#configuration(session),
      );
      session.externalSessionId = externalSessionId;
      this.#attachSession(options.sessionId, session);
      await this.#syncWorkspaceSkills(session.workspaceRoot);
      return { sessionId: options.sessionId, externalSessionId };
    } catch (error) {
      if (!isMissingCodexRolloutError(error)) throw error;
      return this.createSession(options);
    }
  }

  async importSession(
    options: RuntimeSessionImportOptions,
  ): Promise<RuntimeSessionImportResult> {
    const handle = options.appendToExternalSessionId
      ? await this.resumeSession({
          sessionId: options.sessionId,
          workspaceRoot: options.workspaceRoot,
          externalSessionId: options.appendToExternalSessionId,
          ...(options.model ? { model: options.model } : {}),
          ...(options.sandboxMode
            ? { sandboxMode: options.sandboxMode }
            : {}),
          ...(options.approvalPolicy
            ? { approvalPolicy: options.approvalPolicy }
            : {}),
          ...(options.composerMode
            ? { composerMode: options.composerMode }
            : {}),
        })
      : await this.createSession({
          sessionId: options.sessionId,
          workspaceRoot: options.workspaceRoot,
          ...(options.model ? { model: options.model } : {}),
          ...(options.sandboxMode
            ? { sandboxMode: options.sandboxMode }
            : {}),
          ...(options.approvalPolicy
            ? { approvalPolicy: options.approvalPolicy }
            : {}),
          ...(options.composerMode
            ? { composerMode: options.composerMode }
            : {}),
        });
    const session = this.#requireSession(options.sessionId);
    session.silent = true;
    try {
      await this.#runTurn(
        options.sessionId,
        `import:${randomUUID()}`,
        formatCanonicalImport(options.canonicalMessages),
        false,
      );
    } finally {
      session.silent = false;
    }
    return { externalSessionId: handle.externalSessionId };
  }

  async replaceSessionContext(
    sessionId: string,
    canonicalMessages: readonly unknown[],
  ): Promise<string> {
    const session = this.#requireSession(sessionId);
    const previousThreadId = session.externalSessionId;
    const externalSessionId = await (await this.#requireClient()).startThread(
      this.#configuration(session),
    );
    session.externalSessionId = externalSessionId;
    this.#sessionByThread.delete(previousThreadId);
    this.#sessionByThread.set(externalSessionId, sessionId);
    await this.#syncWorkspaceSkills(session.workspaceRoot);
    session.silent = true;
    try {
      await this.#runTurn(
        sessionId,
        `compact-import:${randomUUID()}`,
        formatCanonicalImport(canonicalMessages),
        false,
      );
    } finally {
      session.silent = false;
    }
    return externalSessionId;
  }

  async send(sessionId: string, runId: string, prompt: string): Promise<void> {
    await this.#runTurn(sessionId, runId, prompt, true);
  }

  async cancel(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (!session?.activeTurnId) return;
    await (await this.#requireClient()).interruptTurn(
      session.externalSessionId,
      session.activeTurnId,
    );
  }

  async resolvePermission(
    decision: RuntimePermissionDecision,
  ): Promise<boolean> {
    const pending = this.#pendingApprovals.get(decision.permissionId);
    if (!pending || !this.#transport) return false;
    const option = pending.options.find(
      (candidate) => candidate.optionId === decision.optionId,
    );
    const result =
      decision.cancelled || !option
        ? "cancel"
        : option.kind === "allow_always"
          ? "acceptForSession"
          : option.kind === "allow_once"
            ? "accept"
            : "decline";
    this.#pendingApprovals.delete(decision.permissionId);
    this.#transport.respond(pending.responseId, { decision: result });
    return true;
  }

  async resolveQuestion(
    decision: RuntimeQuestionDecision,
  ): Promise<boolean> {
    const pending = this.#pendingQuestions.get(decision.questionId);
    if (!pending || !this.#transport) return false;
    const answers = Object.fromEntries(
      decision.answers.map((answer) => [
        answer.questionId,
        { answers: answer.optionIds },
      ]),
    );
    this.#pendingQuestions.delete(decision.questionId);
    this.#transport.respond(pending.responseId, { answers });
    return true;
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.#sessions.get(sessionId);
    if (!session) return;
    this.#sessions.delete(sessionId);
    this.#sessionByThread.delete(session.externalSessionId);
    this.#pendingRuns.delete(sessionId);
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#initializing = undefined;
    await this.#client?.dispose();
    this.#sessions.clear();
    this.#sessionByThread.clear();
    this.#pendingApprovals.clear();
    this.#pendingQuestions.clear();
    this.#pendingRuns.clear();
    this.#listeners.clear();
  }

  async #runTurn(
    sessionId: string,
    runId: string,
    prompt: string,
    emitLifecycle: boolean,
  ): Promise<void> {
    const session = this.#requireSession(sessionId);
    if (session.activeRunId) throw new Error("Codex session is already running");
    session.activeRunId = runId;
    if (emitLifecycle) {
      await this.#emit({ type: "run_start", sessionId, runId });
    }
    const completion = new Promise<void>((resolve, reject) => {
      this.#pendingRuns.set(sessionId, { resolve, reject });
    });
    try {
      session.activeTurnId = await (await this.#requireClient()).startTurn(
        session.externalSessionId,
        prompt,
        this.#configuration(session),
      );
      await completion;
    } catch (error) {
      this.#pendingRuns.delete(sessionId);
      if (emitLifecycle) {
        await this.#emit({
          type: "run_end",
          sessionId,
          runId,
          status: "error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
      throw error;
    } finally {
      session.activeRunId = undefined;
      session.activeTurnId = undefined;
    }
  }

  async #handleNotification(
    notification: JsonRpcNotification,
  ): Promise<void> {
    if (notification.method === "skills/changed") {
      void this.#refreshWorkspaceSkills();
      return;
    }
    const params = record(notification.params);
    const threadId = String(params["threadId"] ?? "");
    const sessionId = this.#sessionByThread.get(threadId);
    if (!sessionId) return;
    const session = this.#sessions.get(sessionId);
    if (!session?.activeRunId) return;
    const runId = session.activeRunId;
    if (notification.method === "turn/started") {
      const turn = record(params["turn"]);
      if (typeof turn["id"] === "string") {
        session.activeTurnId = turn["id"];
      }
      return;
    }
    if (notification.method === "item/agentMessage/delta") {
      if (session.silent) return;
      const itemId = String(params["itemId"] ?? "");
      this.#deltaItems.add(`${threadId}:${itemId}`);
      await this.#emit({
        type: "assistant_text",
        sessionId,
        runId,
        executionGroupId: executionGroupId(runId),
        messageId: runtimeToolCallId(runId, itemId),
        delta: String(params["delta"] ?? ""),
      });
      return;
    }
    if (
      notification.method === "item/reasoning/summaryTextDelta" ||
      notification.method === "item/reasoning/textDelta"
    ) {
      if (session.silent) return;
      const itemId = String(params["itemId"] ?? "");
      this.#deltaItems.add(`${threadId}:${itemId}`);
      await this.#emit({
        type: "assistant_thought",
        sessionId,
        runId,
        executionGroupId: executionGroupId(runId),
        messageId: runtimeToolCallId(runId, itemId),
        delta: String(params["delta"] ?? ""),
      });
      return;
    }
    if (
      notification.method === "item/started" ||
      notification.method === "item/completed"
    ) {
      if (session.silent) return;
      const item = record(params["item"]) as unknown as CodexThreadItem;
      await this.#handleItem(
        sessionId,
        runId,
        threadId,
        item,
        notification.method === "item/completed",
      );
      return;
    }
    if (notification.method === "turn/plan/updated") {
      if (session.silent) return;
      const plan = Array.isArray(params["plan"]) ? params["plan"] : [];
      const markdown = plan
        .map((step, index) => {
          const value = record(step);
          const text = String(
            value["step"] ?? value["text"] ?? value["description"] ?? "",
          );
          const status = String(value["status"] ?? "pending");
          return `- [${status === "completed" ? "x" : " "}] ${index + 1}. ${text}`;
        })
        .join("\n");
      if (markdown) {
        await this.#emit({
          type: "tool",
          sessionId,
          runId,
          executionGroupId: executionGroupId(runId),
          callId: `${runId}:native-plan`,
          title: "update_plan",
          kind: "other",
          status: "completed",
          input: { plan: markdown },
        });
      }
      return;
    }
    if (notification.method === "thread/tokenUsage/updated") {
      if (session.silent) return;
      const tokenUsage = record(params["tokenUsage"]);
      // `total` 是整个 thread 的累计，`last` 才是最近一次模型调用。
      // 「当前上下文占用」必须取 last —— 取 total 会得到「会话至今所有轮次之和」，
      // 数值会单调增长到远超模型窗口（曾出现 1.4m 这种不可能的值）。
      const last = record(tokenUsage["last"]);
      const input = Number(last["inputTokens"] ?? 0);
      const output = Number(last["outputTokens"] ?? 0);
      await this.#emit({
        type: "context_usage",
        sessionId,
        runId,
        // 与 Native 的 contextUsageFromModel 同构：totalTokens - output
        used: Math.max(
          0,
          Number(last["totalTokens"] ?? 0) - output,
        ),
        size: Number(tokenUsage["modelContextWindow"] ?? 0),
        input,
        output,
        reasoning: Number(last["reasoningOutputTokens"] ?? 0),
      });
      return;
    }
    if (notification.method === "error") {
      const error = record(params["error"]);
      const message = String(error["message"] ?? params["message"] ?? "Codex error");
      await this.#emit({ type: "runtime_error", sessionId, error: message });
      return;
    }
    if (notification.method === "turn/completed") {
      const turn = record(params["turn"]);
      const status = String(turn["status"] ?? "completed");
      const pending = this.#pendingRuns.get(sessionId);
      this.#pendingRuns.delete(sessionId);
      if (!session.silent) {
        await this.#emit({
          type: "run_end",
          sessionId,
          runId,
          status:
            status === "interrupted"
              ? "cancelled"
              : status === "failed"
                ? "error"
                : "completed",
          ...(status === "failed"
            ? {
                error: String(
                  record(turn["error"])["message"] ?? "Codex turn failed",
                ),
              }
            : {}),
        });
      }
      if (status === "failed") {
        pending?.reject(
          new Error(String(record(turn["error"])["message"] ?? "Codex turn failed")),
        );
      } else {
        pending?.resolve();
      }
    }
  }

  async #handleItem(
    sessionId: string,
    runId: string,
    threadId: string,
    item: CodexThreadItem,
    terminal: boolean,
  ): Promise<void> {
    const callId = runtimeToolCallId(runId, item.id);
    const deltaKey = `${threadId}:${item.id}`;
    if (item.type === "agentMessage") {
      if (terminal && !this.#deltaItems.has(deltaKey) && item.text) {
        await this.#emit({
          type: "assistant_text",
          sessionId,
          runId,
          executionGroupId: executionGroupId(runId),
          messageId: callId,
          delta: item.text,
        });
      }
      return;
    }
    if (item.type === "reasoning") {
      if (terminal && !this.#deltaItems.has(deltaKey)) {
        const text = [...(item.summary ?? []), ...(item.content ?? [])].join("\n");
        if (text) {
          await this.#emit({
            type: "assistant_thought",
            sessionId,
            runId,
            executionGroupId: executionGroupId(runId),
            messageId: callId,
            delta: text,
          });
        }
      }
      return;
    }
    if (item.type === "userMessage" || item.type === "contextCompaction") {
      return;
    }
    const output = terminal ? codexToolOutput(item) : undefined;
    await this.#emit({
      type: "tool",
      sessionId,
      runId,
      executionGroupId: executionGroupId(runId),
      callId,
      title: codexToolTitle(item),
      kind: codexToolKind(codexToolTitle(item)),
      status:
        terminal && item.status === "failed"
          ? "failed"
          : terminal
            ? "completed"
            : "running",
      input: codexToolInput(item),
      ...(output !== undefined ? { output } : {}),
    });
  }

  async #handleServerRequest(request: JsonRpcRequest): Promise<unknown> {
    const params = record(request.params);
    if (
      request.method === "item/commandExecution/requestApproval" ||
      request.method === "item/fileChange/requestApproval" ||
      request.method === "item/permissions/requestApproval"
    ) {
      return this.#requestApproval(
        request,
        params as unknown as CodexApprovalRequest,
      );
    }
    if (request.method === "item/tool/requestUserInput") {
      return this.#requestQuestion(
        request,
        params as unknown as CodexQuestionRequest,
      );
    }
    if (request.method === "item/tool/call") {
      return this.#callDynamicTool(
        request,
        params as unknown as CodexDynamicToolCallRequest,
      );
    }
    if (request.method === "currentTime/read") {
      return { currentTime: new Date().toISOString() };
    }
    throw new Error(`Unsupported Codex app-server request: ${request.method}`);
  }

  #requestApproval(
    request: JsonRpcRequest,
    params: CodexApprovalRequest,
  ): Promise<unknown> {
    const sessionId = this.#sessionByThread.get(params.threadId);
    const session = sessionId ? this.#sessions.get(sessionId) : undefined;
    if (!sessionId || !session?.activeRunId) {
      return Promise.resolve({ decision: "decline" });
    }
    const runId = session.activeRunId;
    const permissionId = `codex-approval:${String(request.id)}`;
    const options: RuntimePermissionOption[] = [
      { optionId: "accept", label: "Allow once", kind: "allow_once" },
      {
        optionId: "acceptForSession",
        label: "Allow for session",
        kind: "allow_always",
      },
      { optionId: "decline", label: "Reject", kind: "reject_once" },
    ];
    this.#pendingApprovals.set(permissionId, {
      responseId: request.id,
      options,
    });
    void this.#emit({
      type: "permission",
      sessionId,
      runId,
      executionGroupId: executionGroupId(runId),
      permissionId,
      callId: runtimeToolCallId(runId, params.itemId),
      title:
        request.method === "item/fileChange/requestApproval"
          ? "edit_file"
          : "run_command",
      toolKind:
        request.method === "item/fileChange/requestApproval"
          ? "edit"
          : "execute",
      input:
        request.method === "item/fileChange/requestApproval"
          ? { path: params.reason ?? params.itemId }
          : { command: params.command ?? "", cwd: params.cwd },
      options,
    });
    // Transport response is sent by resolvePermission.
    return new Promise(() => {});
  }

  #requestQuestion(
    request: JsonRpcRequest,
    params: CodexQuestionRequest,
  ): Promise<unknown> {
    const sessionId = this.#sessionByThread.get(params.threadId);
    const session = sessionId ? this.#sessions.get(sessionId) : undefined;
    if (!sessionId || !session?.activeRunId) {
      return Promise.resolve({ answers: {} });
    }
    const runId = session.activeRunId;
    const questionId = `codex-question:${String(request.id)}`;
    this.#pendingQuestions.set(questionId, { responseId: request.id });
    void this.#emit({
      type: "question",
      sessionId,
      runId,
      executionGroupId: executionGroupId(runId),
      questionId,
      callId: runtimeToolCallId(runId, params.itemId),
      questions: params.questions.map((question) => ({
        id: question.id,
        question: question.question,
        header: question.header,
        allowMultiple: false,
        ...(question.options
          ? {
              options: question.options.map((option) => ({
                id: option.label,
                label: option.label,
                description: option.description,
              })),
            }
          : {}),
      })),
    });
    return new Promise(() => {});
  }

  #callDynamicTool(
    request: JsonRpcRequest,
    params: CodexDynamicToolCallRequest,
  ): Promise<unknown> {
    if (params.tool === "ask_user") {
      const args = record(params.arguments);
      const questions = Array.isArray(args["questions"])
        ? args["questions"].map((value) => {
            const question = record(value);
            return {
              id: String(question["id"] ?? randomUUID()),
              header: String(question["header"] ?? "Question"),
              question: String(question["question"] ?? ""),
              options: Array.isArray(question["options"])
                ? question["options"].map((optionValue) => {
                    const option = record(optionValue);
                    return {
                      label: String(option["id"] ?? option["label"] ?? ""),
                      description: String(option["description"] ?? ""),
                    };
                  })
                : null,
            };
          })
        : [];
      return this.#requestQuestion(request, {
        threadId: params.threadId,
        turnId: params.turnId,
        itemId: params.callId,
        isBlocking: true,
        questions,
      });
    }
    if (params.tool === "create_plan" || params.tool === "update_plan") {
      return Promise.resolve({
        success: true,
        contentItems: [
          {
            type: "inputText",
            text: "Plan recorded for user review. Wait for Build.",
          },
        ],
      });
    }
    return Promise.resolve({
      success: false,
      contentItems: [
        { type: "inputText", text: `Unsupported tool: ${params.tool}` },
      ],
    });
  }

  #localSession(
    options: RuntimeSessionOptions,
    externalSessionId: string,
  ): LocalSession {
    return {
      externalSessionId,
      workspaceRoot: options.workspaceRoot,
      model:
        options.model ??
        this.#options.model ??
        CODEX_DEFAULT_DEEPSEEK_MODEL,
      sandboxMode: options.sandboxMode ?? DEFAULT_SANDBOX_MODE,
      approvalPolicy: options.approvalPolicy ?? DEFAULT_APPROVAL_POLICY,
      composerMode: options.composerMode ?? "agent",
      activeRunId: undefined,
      activeTurnId: undefined,
      silent: false,
    };
  }

  #configuration(session: LocalSession) {
    return {
      workspaceRoot: session.workspaceRoot,
      model: session.model,
      sandboxMode: session.sandboxMode,
      approvalPolicy: session.approvalPolicy,
      composerMode: session.composerMode,
      dynamicTools: PI_LING_CODEX_DYNAMIC_TOOLS,
    };
  }

  #attachSession(sessionId: string, session: LocalSession): void {
    const previous = this.#sessions.get(sessionId);
    if (previous) {
      this.#sessionByThread.delete(previous.externalSessionId);
    }
    this.#sessions.set(sessionId, session);
    this.#sessionByThread.set(session.externalSessionId, sessionId);
  }

  async #syncWorkspaceSkills(workspaceRoot: string): Promise<void> {
    this.#workspaceRoots.add(workspaceRoot);
    const client = this.#client;
    if (!client) return;
    await syncCodexWorkspaceSkills(client, workspaceRoot);
  }

  async #refreshWorkspaceSkills(): Promise<void> {
    const client = this.#client;
    if (!client) return;
    await refreshCodexWorkspaceSkills(client, this.#workspaceRoots);
  }

  async #requireClient(): Promise<CodexAppServerClient> {
    await this.initialize();
    if (!this.#client) {
      throw new Error("Codex app-server connection unavailable");
    }
    return this.#client;
  }

  #requireSession(sessionId: string): LocalSession {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error(`Codex session not found: ${sessionId}`);
    return session;
  }

  async #emit(event: RuntimeEvent): Promise<void> {
    for (const listener of this.#listeners) await listener(event);
  }
}
