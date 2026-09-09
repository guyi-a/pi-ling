import { contentText } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import {
  CodingAgent,
  type ApprovalMode,
  type CodingAgentEvent,
} from "@pi-ling/coding-agent";

import { effectivePrompt } from "../manifest.js";
import type { AgentMetrics, TaskSpec } from "../types.js";
import type { AgentDriver, AgentRunOptions } from "./types.js";

const models = createModels();
models.setProvider(deepseekProvider());

function emptyMetrics(): AgentMetrics {
  return {
    tool_calls: 0,
    validation_calls: 0,
    completion_gate_runs: 0,
    approval_interrupts: 0,
  };
}

export interface NativeAgentDriverOptions {
  approvalMode?: ApprovalMode;
  provider?: string;
  model?: string;
}

export class NativeAgentDriver implements AgentDriver {
  readonly name = "pi-ling-native-agent";
  readonly runtime = "native";
  readonly #approvalMode: ApprovalMode;

  constructor(options: NativeAgentDriverOptions = {}) {
    this.#approvalMode = options.approvalMode ?? "auto";
    void options.provider;
    void options.model;
  }

  async run(
    worktree: string,
    task: TaskSpec,
    timeoutMs: number,
    options: AgentRunOptions = {},
  ) {
    const started = Date.now();
    const prompt = effectivePrompt(task);
    const metrics = emptyMetrics();
    let response = "";
    let assistantChunks: string[] = [];
    let failed = false;
    let failureReason = "";
    const provider = "deepseek";
    const modelId = "deepseek-v4-pro";
    const model = models.getModel(provider, modelId);
    if (!model) {
      return {
        action: {
          name: "native-agent",
          command: prompt,
          exit_code: -1,
          duration_ms: 0,
          stderr: `model unavailable: ${provider}/${modelId}`,
        },
        metrics,
        error: `model unavailable: ${provider}/${modelId}`,
      };
    }

    const agent = await CodingAgent.create({
      workspaceRoot: worktree,
      model,
      streamFn: models.streamSimple.bind(models),
      approvalMode: this.#approvalMode,
      emit: async (event: CodingAgentEvent) => {
        if (event.type === "approval_requested") {
          metrics.approval_interrupts += 1;
          failed = true;
          failureReason = "approval_required";
          agent.cancel();
          return;
        }
        if (event.type !== "agent") return;
        const value = event.event;
        if (value.type === "tool_execution_start") {
          metrics.tool_calls += 1;
          assistantChunks = [];
          if (value.toolCall.name === "run_command") {
            metrics.validation_calls += 1;
          }
        }
        if (
          value.type === "message_update" &&
          value.assistantMessageEvent.type === "text_delta"
        ) {
          assistantChunks.push(value.assistantMessageEvent.delta);
        }
        if (value.type === "agent_end") {
          response = assistantChunks.join("");
        }
      },
    });

    const controller = new AbortController();
    const externalAbort = options.abortSignal;
    const onExternalAbort = () => {
      failed = true;
      failureReason = "cancelled";
      agent.cancel();
    };
    if (externalAbort) {
      if (externalAbort.aborted) {
        onExternalAbort();
      } else {
        externalAbort.addEventListener("abort", onExternalAbort, { once: true });
      }
    }
    const timer = setTimeout(() => {
      failed = true;
      failureReason = "timeout";
      agent.cancel();
    }, timeoutMs);

    try {
      await agent.prompt(prompt, `eval-${task.id}`);
      await agent.waitForIdle();
      if (!response) {
        const lastAssistant = [...agent.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        if (lastAssistant) {
          response = contentText(lastAssistant.content);
        }
      }
    } catch (error) {
      failed = true;
      failureReason =
        error instanceof Error ? error.message : String(error);
    } finally {
      clearTimeout(timer);
      if (externalAbort) {
        externalAbort.removeEventListener("abort", onExternalAbort);
      }
      controller.abort();
      agent.cancel();
      await agent.waitForIdle();
    }

    const durationMs = Date.now() - started;
    if (failed) {
      return {
        action: {
          name: "native-agent",
          command: prompt,
          exit_code: -1,
          duration_ms: durationMs,
          stderr: failureReason,
          ...(failureReason === "timeout" ? { timed_out: true } : {}),
        },
        metrics,
        error: failureReason,
      };
    }

    const errored = agent.messages.some(
      (message) =>
        message.role === "assistant" && message.stopReason === "error",
    );
    if (errored) {
      return {
        action: {
          name: "native-agent",
          command: prompt,
          exit_code: -1,
          duration_ms: durationMs,
          stderr: "agent ended with error",
        },
        metrics,
        error: "agent ended with error",
      };
    }

    return {
      action: {
        name: "native-agent",
        command: prompt,
        exit_code: 0,
        duration_ms: durationMs,
      },
      metrics,
      ...(response ? { response } : {}),
    };
  }
}
