import { randomUUID } from "node:crypto";

import {
  ChangeTracker,
  wrapPromptForComposerMode,
  Workspace,
} from "@pi-ling/coding-agent";
import type {
  RuntimeAdapter,
  RuntimeEvent,
  RuntimePermissionOption,
} from "@pi-ling/runtime-contracts";
import type {
  AgentStatus,
  ApprovalMode,
  ComposerMode,
  ApprovalRequest,
  CanonicalMessage,
  ChangedFile,
  FileDiff,
  PromptAttachment,
  RuntimeKind,
  SessionSummary,
  SessionEventEnvelope,
  TimelineEnvelope,
  TimelineSnapshot,
} from "@pi-ling/contracts";
import {
  projectCanonicalMessages,
  TimelineProjector,
} from "@pi-ling/session-events";

import { CodexRuntimeAdapter } from "@pi-ling/codex-runtime";
import { isLlmConfigured } from "@pi-ling/llm-config";
import { getResolvedLlmConfig } from "./llm-config-store.js";
import {
  hasCallUsage,
  toAgentUsage,
  type CodexCallUsage,
} from "./codex-call-usage.js";
import {
  buildCodexThreadOptions,
  evaluateCodexApproval,
  mapCodexApprovalPolicy,
  mapCodexSandboxMode,
} from "./codex-approval-policy.js";
import {
  isFileAffectingCodexTool,
  resolveToolWorkspacePath,
} from "./codex-tool-changes.js";
import { diffLineStats } from "./diff-stats.js";
import { RunMessageBuffer } from "./run-message-buffer.js";
import { maybeCompactSessionBeforeRun } from "./session-compaction.js";
import { SessionStore } from "./session-store/session-store.js";

interface PendingPermission {
  runId: string;
  turnId: string;
  runtimePermissionId: string;
  approval: ApprovalRequest;
  options: RuntimePermissionOption[];
}

interface PendingQuestion {
  runId: string;
  turnId: string;
  runtimeQuestionId: string;
}

interface ContextUsage {
  used: number;
  size: number;
}

const CODEX_PROJECTION_VERSION = 2;

export class CodexAgentSession {
  readonly #store: SessionStore;
  readonly #session: SessionSummary;
  readonly #runtime: CodexRuntimeAdapter;
  readonly #emit: (envelope: TimelineEnvelope) => void;
  readonly #availableRuntimes: RuntimeKind[];
  readonly #buffer: RunMessageBuffer;
  readonly #projector: TimelineProjector;
  readonly #unsubscribe: () => void;
  readonly #pending = new Map<string, PendingPermission>();
  readonly #pendingQuestions = new Map<string, PendingQuestion>();
  readonly #tools = new Set<string>();
  #activeRunId: string | null = null;
  #assistantOpen = false;
  #assistantMessageId: string | null = null;
  #assistantText = "";
  #assistantReasoning = "";
  #assistantToolCalls: Array<{
    toolCallId: string;
    name: string;
    input: Record<string, unknown>;
  }> = [];
  #approvalMode: ApprovalMode;
  #composerMode: ComposerMode;
  #contextUsage: ContextUsage | undefined;
  #callUsage: CodexCallUsage | undefined;
  #runTurn = 0;
  #changes: ChangeTracker | null = null;
  #workspaceRoot: string;

  private constructor(options: {
    store: SessionStore;
    session: SessionSummary;
    runtime: CodexRuntimeAdapter;
    emit: (envelope: TimelineEnvelope) => void;
    availableRuntimes: RuntimeKind[];
    buffer: RunMessageBuffer;
  }) {
    this.#store = options.store;
    this.#session = options.session;
    this.#runtime = options.runtime;
    this.#emit = options.emit;
    this.#availableRuntimes = options.availableRuntimes;
    this.#buffer = options.buffer;
    this.#projector = new TimelineProjector(
      options.session.id,
      options.store.loadSessionEvents(options.session.id),
    );
    this.#approvalMode = options.session.approvalMode;
    this.#composerMode = options.session.composerMode ?? "agent";
    this.#workspaceRoot = options.session.workspace.root;
    this.#unsubscribe = this.#runtime.subscribe(async (event) => {
      await this.#handleRuntimeEvent(event);
    });
  }

  static async open(options: {
    store: SessionStore;
    session: SessionSummary;
    runtime: CodexRuntimeAdapter;
    emit: (envelope: TimelineEnvelope) => void;
    availableRuntimes: RuntimeKind[];
    buffer: RunMessageBuffer;
  }): Promise<CodexAgentSession> {
    const instance = new CodexAgentSession(options);
    try {
      const workspace = await Workspace.open(options.session.workspace.root);
      instance.#changes = new ChangeTracker(workspace);
      instance.#changes.hydrateBaselines(
        options.store.loadBaselines(options.session.id),
      );
    } catch {
      instance.#changes = null;
    }
    const storedRuntime = options.store.getRuntimeSession(
      options.session.id,
      "codex",
    );
    const externalSessionId = storedRuntime?.externalSessionId;
    const events = options.store.loadSessionEvents(options.session.id);
    const messages = projectCanonicalMessages(events);
    const watermark =
      storedRuntime?.lastSyncedCanonicalSeq ?? 0;
    const threadOptions = buildCodexThreadOptions(
      options.session.approvalMode,
      options.session.composerMode ?? "agent",
    );
    const llmConfig = getResolvedLlmConfig();
    const importOptions = {
      workspaceRoot: options.session.workspace.root,
      provider: llmConfig.provider,
      model: llmConfig.model,
      ...threadOptions,
    };
    const resumeCodexSession = async (externalId: string) => {
      const handle = await options.runtime.resumeSession({
        sessionId: options.session.id,
        workspaceRoot: options.session.workspace.root,
        externalSessionId: externalId,
        ...threadOptions,
      });
      const resolvedId = handle.externalSessionId;
      if (resolvedId === externalId) return;

      if (messages.length > 0 && options.runtime.importSession) {
        await options.runtime.importSession({
          sessionId: options.session.id,
          appendToExternalSessionId: resolvedId,
          ...importOptions,
          canonicalMessages: messages,
        });
      }
      options.store.setRuntimeImport(
        options.session.id,
        resolvedId,
        events.at(-1)?.seq ?? 0,
        CODEX_PROJECTION_VERSION,
      );
    };

    const crossesCompactionBoundary = events.some(
      (envelope) =>
        envelope.seq > watermark &&
        envelope.event.kind === "compaction.applied",
    );
    const needsFullProjection =
      messages.length > 0 &&
      (!externalSessionId ||
        (storedRuntime?.projectionVersion ?? 1) <
          CODEX_PROJECTION_VERSION ||
        crossesCompactionBoundary);

    if (needsFullProjection && options.runtime.importSession) {
      const imported = await options.runtime.importSession({
        sessionId: randomUUID(),
        ...importOptions,
        canonicalMessages: messages,
      });
      options.store.setRuntimeImport(
        options.session.id,
        imported.externalSessionId,
        events.at(-1)?.seq ?? 0,
        CODEX_PROJECTION_VERSION,
      );
      await resumeCodexSession(imported.externalSessionId);
      instance.#applyRuntimeOptions();
      return instance;
    }

    if (!externalSessionId) {
      const handle = await options.runtime.createSession({
        sessionId: options.session.id,
        workspaceRoot: options.session.workspace.root,
        ...threadOptions,
      });
      options.store.setRuntimeSessionId(
        options.session.id,
        handle.externalSessionId,
      );
      options.store.upsertRuntimeSession({
        sessionId: options.session.id,
        runtimeKind: "codex",
        externalSessionId: handle.externalSessionId,
        projectionVersion: CODEX_PROJECTION_VERSION,
      });
      instance.#applyRuntimeOptions();
      return instance;
    }

    // Import only canonical events written by another runtime after Codex last
    // consumed the shared history. Compaction boundaries rotate above.
    if (options.runtime.importSession) {
      const delta = projectCanonicalMessages(
        events.filter((envelope) => envelope.seq > watermark),
      );
      if (delta.length > 0) {
        const imported = await options.runtime.importSession({
          sessionId: options.session.id,
          appendToExternalSessionId: externalSessionId,
          ...importOptions,
          canonicalMessages: delta,
        });
        options.store.setRuntimeImport(
          options.session.id,
          imported.externalSessionId,
          events.at(-1)?.seq ?? 0,
          CODEX_PROJECTION_VERSION,
        );
        await resumeCodexSession(imported.externalSessionId);
        instance.#applyRuntimeOptions();
        return instance;
      }
    }

    await resumeCodexSession(externalSessionId);
    instance.#applyRuntimeOptions();
    return instance;
  }

  get sessionId(): string {
    return this.#session.id;
  }

  get status(): AgentStatus {
    return {
      sessionId: this.#session.id,
      runtimeKind: "codex",
      availableRuntimes: this.#availableRuntimes,
      provider: getResolvedLlmConfig().provider,
      model: getResolvedLlmConfig().model,
      configured: isLlmConfigured(getResolvedLlmConfig()),
      approvalMode: this.#approvalMode,
      composerMode: this.#composerMode,
      workspace: this.#session.workspace,
    };
  }

  snapshot(): TimelineSnapshot {
    return this.#projector.snapshot();
  }

  startPrompt(
    runId: string,
    prompt: string,
    attachments?: PromptAttachment[],
  ): void {
    if ((attachments?.length ?? 0) > 0) {
      throw new Error("Image attachments are only supported on Native runtime");
    }
    if (this.#activeRunId) throw new Error("Codex is already running");
    this.#applyRuntimeOptions();
    this.#activeRunId = runId;
    this.#assistantOpen = false;
    this.#assistantMessageId = null;
    this.#assistantText = "";
    this.#assistantReasoning = "";
    this.#assistantToolCalls = [];
    this.#contextUsage = undefined;
    this.#callUsage = undefined;
    this.#runTurn = 0;
    const userMessage: CanonicalMessage = {
      id: `${runId}:user`,
      role: "user",
      content: [{ type: "text", text: prompt }],
      sourceRuntime: "codex",
      createdAt: Date.now(),
    };
    const runtimePrompt = wrapPromptForComposerMode(
      prompt,
      this.#composerMode,
    );
    void (async () => {
      const compacted = await maybeCompactSessionBeforeRun(
        this.#store,
        this.#session.id,
      );
      if (compacted) {
        this.#flush(compacted);
        const events = this.#store.loadSessionEvents(this.#session.id);
        const externalSessionId = await this.#runtime.replaceSessionContext(
          this.#session.id,
          projectCanonicalMessages(events),
        );
        this.#store.setRuntimeImport(
          this.#session.id,
          externalSessionId,
          events.at(-1)?.seq ?? 0,
          CODEX_PROJECTION_VERSION,
        );
      }
      this.#store.setLifecycle(this.#session.id, "running", runId);
      this.#flush(
        this.#store.appendSessionEvent({
          sessionId: this.#session.id,
          runtimeKind: "codex",
          runId,
          messageId: userMessage.id,
          idempotencyKey: `run:${runId}:start`,
          event: { kind: "run.started", userMessage },
        }),
      );
      await this.#runtime.send(this.#session.id, runId, runtimePrompt);
    })()
      .catch((error) => {
        if (this.#activeRunId !== runId) return;
        const message =
          error instanceof Error ? error.message : String(error);
        this.#flush(
          this.#store.appendSessionEvent({
            sessionId: this.#session.id,
            runtimeKind: "codex",
            runId,
            idempotencyKey: `run:${runId}:end`,
            event: { kind: "run.ended", status: "crashed" },
          }),
        );
        this.#store.setLifecycle(this.#session.id, "crashed");
        this.#buffer.endRun(this.#session.id, runId);
        console.error(`Codex run failed: ${message}`);
      })
      .finally(() => {
        const externalSessionId = this.#runtime.getExternalSessionId(
          this.#session.id,
        );
        if (externalSessionId) {
          this.#store.setRuntimeSessionId(this.#session.id, externalSessionId);
          this.#store.upsertRuntimeSession({
            sessionId: this.#session.id,
            runtimeKind: "codex",
            externalSessionId,
            projectionVersion: CODEX_PROJECTION_VERSION,
          });
        }
        if (this.#activeRunId === runId) this.#activeRunId = null;
      });
  }

  async cancel(runId: string): Promise<boolean> {
    if (this.#activeRunId !== runId) return false;
    await this.#runtime.cancel(this.#session.id);
    return true;
  }

  async resolveQuestion(
    callId: string,
    answers: import("@pi-ling/contracts").AskUserAnswer[],
  ): Promise<boolean> {
    const pending = this.#pendingQuestions.get(callId);
    if (!pending || !this.#runtime.resolveQuestion) return false;
    const resolved = await this.#runtime.resolveQuestion({
      questionId: pending.runtimeQuestionId,
      answers: answers.map((answer) => ({
        questionId: answer.id,
        optionIds:
          answer.selected.length > 0
            ? answer.selected
            : answer.custom
              ? [answer.custom]
              : [],
      })),
    });
    if (!resolved) return false;
    this.#pendingQuestions.delete(callId);
    this.#flush(
      this.#store.appendSessionEvent({
        sessionId: this.#session.id,
        runtimeKind: "codex",
        runId: pending.runId,
        turnId: pending.turnId,
        toolCallId: callId,
        idempotencyKey: `question:${callId}:answered`,
        event: {
          kind: "question.answered",
          toolItemId: callId,
          callId,
          answers,
        },
      }),
    );
    this.#store.setLifecycle(this.#session.id, "running", pending.runId);
    return true;
  }

  async resolveApproval(
    callId: string,
    decision: { approved: boolean; effectDigest: string },
  ): Promise<boolean> {
    const pending = this.#pending.get(callId);
    if (
      !pending ||
      pending.approval.effectDigest !== decision.effectDigest
    ) {
      return false;
    }
    const option = pending.options.find((candidate) =>
      decision.approved
        ? candidate.kind === "allow_once" ||
          candidate.kind === "allow_always"
        : candidate.kind === "reject_once" ||
          candidate.kind === "reject_always",
    );
    this.#flush(
      this.#store.appendSessionEvent({
        sessionId: this.#session.id,
        runtimeKind: "codex",
        runId: pending.runId,
        turnId: pending.turnId,
        toolCallId: callId,
        idempotencyKey: `approval:${callId}:resolved`,
        event: {
          kind: "approval.resolved",
          toolItemId: callId,
          callId,
          approved: decision.approved,
        },
      }),
    );
    this.#pending.delete(callId);
    return this.#runtime.resolvePermission({
      permissionId: pending.runtimePermissionId,
      ...(option ? { optionId: option.optionId } : { cancelled: true }),
    });
  }

  changedFiles(): Promise<ChangedFile[]> {
    return this.#changes?.changedFiles() ?? Promise.resolve([]);
  }

  diff(userPath: string): Promise<FileDiff | undefined> {
    return this.#changes?.diff(userPath) ?? Promise.resolve(undefined);
  }

  setApprovalMode(mode: ApprovalMode): SessionSummary {
    this.#approvalMode = mode;
    this.#applyRuntimeOptions();
    return this.#store.setApprovalMode(this.#session.id, mode);
  }

  setComposerMode(mode: ComposerMode): SessionSummary {
    this.#composerMode = mode;
    this.#applyRuntimeOptions();
    return this.#store.setComposerMode(this.#session.id, mode);
  }

  #applyRuntimeOptions(): void {
    this.#runtime.setSessionOptions(this.#session.id, {
      sandboxMode:
        this.#approvalMode === "manual"
          ? "read-only"
          : mapCodexSandboxMode(this.#composerMode),
      approvalPolicy: mapCodexApprovalPolicy(this.#approvalMode),
      composerMode: this.#composerMode,
    });
  }

  async dispose(): Promise<void> {
    this.#unsubscribe();
    await this.#runtime.closeSession(this.#session.id).catch(() => {});
    this.#activeRunId = null;
  }

  #flush(envelope: SessionEventEnvelope): void {
    for (const next of this.#projector.push(envelope)) {
      this.#emit(next);
    }
  }

  #turnIdFor(runId: string, messageId?: string): string {
    return messageId ?? `${runId}:assistant`;
  }

  #ensureAssistant(runId: string, messageId?: string): string {
    const turnId = this.#turnIdFor(runId, messageId);
    if (this.#assistantOpen && this.#assistantMessageId !== turnId) {
      this.#closeAssistant(runId);
    }
    if (!this.#assistantOpen) {
      this.#runTurn += 1;
      const turn = this.#runTurn;
      this.#assistantOpen = true;
      this.#assistantMessageId = turnId;
      this.#assistantText = "";
      this.#assistantReasoning = "";
      this.#assistantToolCalls = [];
      // 每次模型调用（= 一个 assistant 消息）拥有自己的用量；
      // 不复用上一个消息的值，否则没有收到 tokenUsage 的调用会继承旧数据。
      this.#contextUsage = undefined;
      this.#callUsage = undefined;
      this.#flush(
        this.#store.appendSessionEvent({
          sessionId: this.#session.id,
          runtimeKind: "codex",
          runId,
          turnId,
          idempotencyKey: `turn:${turnId}:start`,
          event: { kind: "turn.started", turn },
        }),
      );
    }
    return turnId;
  }

  #closeAssistant(runId: string, stopReason?: string): void {
    if (!this.#assistantOpen || !this.#assistantMessageId) return;
    const turnId = this.#assistantMessageId;
    const effectiveStop =
      stopReason ??
      (this.#assistantToolCalls.length > 0 ? "toolUse" : "stop");
    const message: CanonicalMessage = {
      id: turnId,
      role: "assistant",
      content: [
        ...(this.#assistantReasoning
          ? [{
              type: "reasoning" as const,
              text: this.#assistantReasoning,
              signature: "reasoning_content",
            }]
          : []),
        ...(this.#assistantText
          ? [{ type: "text" as const, text: this.#assistantText }]
          : []),
        ...this.#assistantToolCalls.map((call) => ({
          type: "tool-call" as const,
          toolCallId: call.toolCallId,
          name: call.name,
          input: call.input,
        })),
      ],
      sourceRuntime: "codex",
      createdAt: Date.now(),
    };
    this.#flush(
      this.#store.appendSessionEvent({
        sessionId: this.#session.id,
        runtimeKind: "codex",
        runId,
        turnId,
        messageId: turnId,
        idempotencyKey: `assistant:${turnId}`,
        event: {
          kind: "message.assistant.committed",
          message,
          stopReason: effectiveStop,
          usage: toAgentUsage(this.#callUsage),
          ...(this.#contextUsage ? { contextUsage: this.#contextUsage } : {}),
        },
      }),
    );
    this.#buffer.commitMessage(this.#session.id, runId, turnId);
    this.#assistantOpen = false;
    this.#assistantMessageId = null;
    this.#assistantText = "";
    this.#assistantReasoning = "";
    this.#assistantToolCalls = [];
  }

  #recordContextUsage(
    runId: string,
    context: ContextUsage,
    call: CodexCallUsage | undefined,
  ): void {
    this.#contextUsage = context;
    if (call) this.#callUsage = call;
    this.#store.appendSessionEvent({
      sessionId: this.#session.id,
      runtimeKind: "codex",
      runId,
      idempotencyKey: `run:${runId}:context-usage:${context.used}:${context.size}:${call?.output ?? 0}`,
      event: {
        kind: "usage.recorded",
        usage: toAgentUsage(call),
        contextUsage: context,
      },
    });
  }

  async #handleRuntimeEvent(event: RuntimeEvent): Promise<void> {
    if (event.sessionId && event.sessionId !== this.#session.id) return;
    if (event.type === "runtime_error") {
      if (this.#activeRunId) {
        this.#flush(
          this.#store.appendSessionEvent({
            sessionId: this.#session.id,
            runtimeKind: "codex",
            runId: this.#activeRunId,
            idempotencyKey: `run:${this.#activeRunId}:end`,
            event: { kind: "run.ended", status: "crashed" },
          }),
        );
        this.#store.setLifecycle(this.#session.id, "crashed");
        this.#buffer.endRun(this.#session.id, this.#activeRunId);
      }
      return;
    }
    const runId = "runId" in event ? event.runId : this.#activeRunId;
    if (!runId || runId !== this.#activeRunId) return;
    if (event.type === "run_start") return;
    if (event.type === "assistant_thought") {
      const turnId = this.#ensureAssistant(runId, event.messageId);
      this.#assistantReasoning += event.delta;
      this.#buffer.ingest({
        sessionId: this.#session.id,
        runId,
        turnId,
        messageId: turnId,
        emittedAt: Date.now(),
        frame: { kind: "assistant.reasoning.delta", delta: event.delta },
      });
    } else if (event.type === "assistant_text") {
      const turnId = this.#ensureAssistant(runId, event.messageId);
      this.#assistantText += event.delta;
      this.#buffer.ingest({
        sessionId: this.#session.id,
        runId,
        turnId,
        messageId: turnId,
        emittedAt: Date.now(),
        frame: { kind: "assistant.text.delta", delta: event.delta },
      });
    } else if (event.type === "context_usage") {
      const call: CodexCallUsage = {
        input: event.input ?? 0,
        output: event.output ?? 0,
        reasoning: event.reasoning ?? 0,
      };
      this.#recordContextUsage(
        runId,
        { used: event.used, size: event.size },
        // 协议不提供逐次用量时（如 ACP）保持 undefined，footer 就不显示「输出」
        hasCallUsage(call) ? call : undefined,
      );
    } else if (event.type === "tool") {
      const turnId = this.#assistantMessageId ?? `${runId}:exec`;
      const arguments_ =
        typeof event.input === "object" && event.input !== null
          ? (event.input as Record<string, unknown>)
          : {};
      if (!this.#tools.has(event.callId)) {
        this.#tools.add(event.callId);
        this.#assistantToolCalls.push({
          toolCallId: event.callId,
          name: event.title,
          input: arguments_,
        });
        this.#ensureAssistant(runId, turnId);
        this.#flush(
          this.#store.appendSessionEvent({
            sessionId: this.#session.id,
            runtimeKind: "codex",
            runId,
            turnId,
            toolCallId: event.callId,
            idempotencyKey: `tool:${event.callId}:call`,
            event: {
              kind: "tool.call.committed",
              toolCall: {
                id: event.callId,
                name: event.title,
                input: arguments_,
              },
            },
          }),
        );
      }
      if (event.status === "running") {
        await this.#captureToolFile(event.title, arguments_, event.kind);
        this.#flush(
          this.#store.appendSessionEvent({
            sessionId: this.#session.id,
            runtimeKind: "codex",
            runId,
            turnId,
            toolCallId: event.callId,
            idempotencyKey: `tool:${event.callId}:start`,
            event: {
              kind: "tool.execution.started",
              toolCallId: event.callId,
            },
          }),
        );
      } else {
        this.#flush(
          this.#store.appendSessionEvent({
            sessionId: this.#session.id,
            runtimeKind: "codex",
            runId,
            turnId,
            messageId: `tool:${event.callId}`,
            toolCallId: event.callId,
            idempotencyKey: `tool:${event.callId}:result`,
            event: {
              kind: "tool.result.committed",
              result: {
                toolCallId: event.callId,
                content: event.output ?? "",
                isError: event.status === "failed",
                rawPayload: { codex: event },
              },
            },
          }),
        );
        if (event.status !== "failed") {
          await this.#emitToolChanges(
            runId,
            turnId,
            event.callId,
            event.title,
            arguments_,
            event.kind,
          );
        }
      }
    } else if (event.type === "question") {
      const turnId = this.#assistantMessageId ?? `${runId}:question`;
      this.#pendingQuestions.set(event.callId, {
        runId,
        turnId,
        runtimeQuestionId: event.questionId,
      });
      this.#flush(
        this.#store.appendSessionEvent({
          sessionId: this.#session.id,
          runtimeKind: "codex",
          runId,
          turnId,
          toolCallId: event.callId,
          idempotencyKey: `question:${event.callId}:requested`,
          event: {
            kind: "question.requested",
            toolItemId: event.callId,
            question: {
              callId: event.callId,
              questions: event.questions.map((question) => ({
                id: question.id,
                question: question.question,
                ...(question.header ? { header: question.header } : {}),
                ...(question.options
                  ? {
                      options: question.options.map((option) => ({
                        label: option.label,
                        ...(option.description
                          ? { description: option.description }
                          : {}),
                      })),
                    }
                  : {}),
              })),
            },
          },
        }),
      );
      this.#store.setLifecycle(this.#session.id, "awaiting_question", runId);
    } else if (event.type === "permission") {
      await this.#handlePermission(event);
    } else if (event.type === "run_end") {
      this.#closeAssistant(
        runId,
        event.status === "completed" ? undefined : event.status,
      );
      this.#flush(
        this.#store.appendSessionEvent({
          sessionId: this.#session.id,
          runtimeKind: "codex",
          runId,
          idempotencyKey: `run:${runId}:end`,
          event: { kind: "run.ended", status: event.status },
        }),
      );
      this.#store.setLifecycle(this.#session.id, "idle");
      this.#buffer.endRun(this.#session.id, runId);
    }
  }

  async #captureToolFile(
    title: string,
    input: Record<string, unknown>,
    toolKind?: string,
  ): Promise<void> {
    if (!this.#changes || !isFileAffectingCodexTool(title, toolKind)) return;
    const userPath = resolveToolWorkspacePath(input, this.#workspaceRoot);
    if (!userPath) return;
    try {
      await this.#changes.capture(userPath);
    } catch {
      /* 路径无效或文件不可读时跳过，避免阻断 tool 流程 */
    }
  }

  async #emitToolChanges(
    runId: string,
    turnId: string,
    callId: string,
    title: string,
    input: Record<string, unknown>,
    toolKind?: string,
  ): Promise<void> {
    if (!this.#changes || !isFileAffectingCodexTool(title, toolKind)) return;
    const userPath = resolveToolWorkspacePath(input, this.#workspaceRoot);
    if (userPath) {
      try {
        await this.#changes.capture(userPath);
      } catch {
        /* ignore */
      }
    }
    let files;
    try {
      files = await Promise.all(
        (await this.#changes.changedFiles()).map(async (file) => {
          if (file.binary || file.sensitive || file.tooLarge) return file;
          const diff = await this.#changes!.diff(file.path);
          return diff ? { ...file, ...diffLineStats(diff.patch) } : file;
        }),
      );
    } catch {
      return;
    }
    if (files.length === 0) return;
    for (const baseline of this.#changes.exportBaselines()) {
      this.#store.saveBaseline(this.#session.id, baseline);
    }
    this.#flush(
      this.#store.appendSessionEvent({
        sessionId: this.#session.id,
        runtimeKind: "codex",
        runId,
        turnId,
        toolCallId: callId,
        idempotencyKey: `changes:${callId}`,
        event: {
          kind: "changes.committed",
          callId,
          files,
        },
      }),
    );
  }

  async #handlePermission(
    event: Extract<RuntimeEvent, { type: "permission" }>,
  ): Promise<void> {
    const mode = this.#approvalMode;
    const input =
      typeof event.input === "object" && event.input !== null
        ? (event.input as Record<string, unknown>)
        : {};
    const turnId = this.#assistantMessageId ?? `${event.runId}:exec`;
    if (!this.#tools.has(event.callId)) {
      this.#tools.add(event.callId);
      this.#assistantToolCalls.push({
        toolCallId: event.callId,
        name: event.title,
        input,
      });
      this.#ensureAssistant(event.runId, turnId);
      this.#flush(
        this.#store.appendSessionEvent({
          sessionId: this.#session.id,
          runtimeKind: "codex",
          runId: event.runId,
          turnId,
          toolCallId: event.callId,
          idempotencyKey: `tool:${event.callId}:call`,
          event: {
            kind: "tool.call.committed",
            toolCall: {
              id: event.callId,
              name: event.title,
              input,
            },
          },
        }),
      );
    }
    const allowOption = event.options.find(
      (option) =>
        option.kind === "allow_once" || option.kind === "allow_always",
    );
    if (
      event.title.trim().toLowerCase() === "exit_plan_mode" &&
      allowOption
    ) {
      await this.#runtime.resolvePermission({
        permissionId: event.permissionId,
        optionId: allowOption.optionId,
      });
      return;
    }
    const evaluation = evaluateCodexApproval(
      {
        callId: event.callId,
        title: event.title,
        ...(event.toolKind ? { toolKind: event.toolKind } : {}),
        input,
      },
      mode,
      this.#session.workspace.root,
    );
    if (!evaluation.reason && allowOption) {
      await this.#runtime.resolvePermission({
        permissionId: event.permissionId,
        optionId: allowOption.optionId,
      });
      return;
    }

    const approval: ApprovalRequest = {
      callId: event.callId,
      tool: event.title,
      arguments: input,
      effect: { ...evaluation.effect },
      effectDigest: evaluation.effectDigest,
      reason:
        evaluation.reason ?? "Codex permission requires an explicit decision",
    };
    this.#pending.set(event.callId, {
      runId: event.runId,
      turnId,
      runtimePermissionId: event.permissionId,
      approval,
      options: event.options,
    });
    this.#flush(
      this.#store.appendSessionEvent({
        sessionId: this.#session.id,
        runtimeKind: "codex",
        runId: event.runId,
        turnId,
        toolCallId: event.callId,
        idempotencyKey: `approval:${event.callId}:requested`,
        event: {
          kind: "approval.requested",
          toolItemId: event.callId,
          approval,
        },
      }),
    );
    this.#store.setLifecycle(
      this.#session.id,
      "awaiting_approval",
      event.runId,
    );
  }
}
