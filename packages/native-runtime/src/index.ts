import {
  CodingAgent,
  type CodingAgentEvent,
} from "@pi-ling/coding-agent";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import type {
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeEventListener,
  RuntimePermissionDecision,
  RuntimeSessionHandle,
  RuntimeSessionOptions,
} from "@pi-ling/runtime-contracts";

const models = createModels();
models.setProvider(deepseekProvider());

function executionGroupId(runId: string): string {
  return `${runId}:exec`;
}

export class NativeRuntimeAdapter implements RuntimeAdapter {
  readonly kind = "native" as const;
  readonly capabilities: RuntimeCapabilities = {
    modelSwitching: false,
    partialStreaming: true,
    toolApproval: true,
    mcp: false,
    hooks: false,
    sandbox: false,
    subagents: false,
    resume: true,
    fork: false,
    fileCheckpoint: true,
  };
  readonly #listeners = new Set<RuntimeEventListener>();
  readonly #sessions = new Map<string, CodingAgent>();
  readonly #permissions = new Map<
    string,
    { sessionId: string; callId: string; effectDigest: string }
  >();

  async initialize(): Promise<void> {}

  async createSession(
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSessionHandle> {
    const model = models.getModel(
      options.provider ?? "deepseek",
      options.model ?? "deepseek-v4-flash",
    );
    if (!model) throw new Error("Native runtime model is unavailable");
    let agent!: CodingAgent;
    agent = await CodingAgent.create({
      workspaceRoot: options.workspaceRoot,
      model,
      streamFn: models.streamSimple.bind(models),
      emit: (event) => this.#handleEvent(options.sessionId, agent, event),
    });
    this.#sessions.set(options.sessionId, agent);
    return {
      sessionId: options.sessionId,
      externalSessionId: options.sessionId,
    };
  }

  resumeSession(
    options: RuntimeSessionOptions,
  ): Promise<RuntimeSessionHandle> {
    return this.createSession(options);
  }

  async send(
    sessionId: string,
    runId: string,
    prompt: string,
  ): Promise<void> {
    const agent = this.#sessions.get(sessionId);
    if (!agent) throw new Error(`Native session not found: ${sessionId}`);
    await this.#emit({ type: "run_start", sessionId, runId });
    await agent.prompt(prompt, runId);
  }

  async cancel(sessionId: string): Promise<void> {
    this.#sessions.get(sessionId)?.cancel();
  }

  async resolvePermission(
    decision: RuntimePermissionDecision,
  ): Promise<boolean> {
    const pending = this.#permissions.get(decision.permissionId);
    if (!pending) return false;
    const agent = this.#sessions.get(pending.sessionId);
    if (!agent) return false;
    this.#permissions.delete(decision.permissionId);
    return agent.resolveApproval(pending.callId, {
      approved: !decision.cancelled && decision.optionId === "allow-once",
      effectDigest: pending.effectDigest,
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    const agent = this.#sessions.get(sessionId);
    if (!agent) return;
    agent.cancel();
    await agent.waitForIdle();
    this.#sessions.delete(sessionId);
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async dispose(): Promise<void> {
    await Promise.all(
      [...this.#sessions.keys()].map((id) => this.closeSession(id)),
    );
    this.#listeners.clear();
  }

  async #handleEvent(
    sessionId: string,
    agent: CodingAgent,
    event: CodingAgentEvent,
  ): Promise<void> {
    if (event.type === "approval_requested") {
      this.#permissions.set(event.approval.callId, {
        sessionId,
        callId: event.approval.callId,
        effectDigest: event.approval.effectDigest,
      });
      await this.#emit({
        type: "permission",
        sessionId,
        runId: event.approval.runId,
        executionGroupId: executionGroupId(event.approval.runId),
        permissionId: event.approval.callId,
        callId: event.approval.callId,
        title: event.approval.tool,
        input: event.approval.arguments,
        options: [
          { optionId: "allow-once", label: "Allow once", kind: "allow_once" },
          { optionId: "reject-once", label: "Reject", kind: "reject_once" },
        ],
      });
      return;
    }
    if (event.type !== "agent") return;
    const value = event.event;
    if (
      value.type === "message_update" &&
      value.assistantMessageEvent.type === "text_delta"
    ) {
      await this.#emit({
        type: "assistant_text",
        sessionId,
        runId: value.runId,
        executionGroupId: executionGroupId(value.runId),
        delta: value.assistantMessageEvent.delta,
      });
    } else if (
      value.type === "message_update" &&
      value.assistantMessageEvent.type === "thinking_delta"
    ) {
      await this.#emit({
        type: "assistant_thought",
        sessionId,
        runId: value.runId,
        executionGroupId: executionGroupId(value.runId),
        delta: value.assistantMessageEvent.delta,
      });
    } else if (value.type === "tool_execution_start") {
      await this.#emit({
        type: "tool",
        sessionId,
        runId: value.runId,
        executionGroupId: executionGroupId(value.runId),
        callId: value.toolCall.id,
        title: value.toolCall.name,
        status: "running",
        input: value.toolCall.arguments,
      });
    } else if (value.type === "tool_execution_end") {
      await this.#emit({
        type: "tool",
        sessionId,
        runId: value.runId,
        executionGroupId: executionGroupId(value.runId),
        callId: value.toolCall.id,
        title: value.toolCall.name,
        status: value.result.isError ? "failed" : "completed",
        output: value.result.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("\n"),
      });
    } else if (value.type === "agent_end") {
      await this.#emit({
        type: "run_end",
        sessionId,
        runId: value.runId,
        status: agent.messages.some(
          (message) =>
            message.role === "assistant" &&
            message.stopReason === "error",
        )
          ? "error"
          : "completed",
      });
    }
  }

  async #emit(event: RuntimeEvent): Promise<void> {
    for (const listener of this.#listeners) await listener(event);
  }
}
