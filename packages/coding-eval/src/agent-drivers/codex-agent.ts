import { randomUUID } from "node:crypto";

import { CodexRuntimeAdapter } from "@pi-ling/codex-runtime";
import type { RuntimeEvent } from "@pi-ling/runtime-contracts";

import { effectivePrompt } from "../manifest.js";
import type { AgentMetrics, TaskSpec } from "../types.js";
import {
  buildCodexRuntimeOptions,
  defaultCodexEvalHome,
} from "./codex-env.js";
import { waitUntil } from "./wait-for-run.js";
import type { AgentDriver, AgentRunOptions } from "./types.js";

function emptyMetrics(): AgentMetrics {
  return {
    tool_calls: 0,
    validation_calls: 0,
    completion_gate_runs: 0,
    approval_interrupts: 0,
  };
}

let sharedEvalRuntime: CodexRuntimeAdapter | undefined;

async function sharedCodexEvalRuntime(): Promise<CodexRuntimeAdapter> {
  if (!sharedEvalRuntime) {
    sharedEvalRuntime = new CodexRuntimeAdapter(
      buildCodexRuntimeOptions(defaultCodexEvalHome()),
    );
    await sharedEvalRuntime.initialize();
  }
  return sharedEvalRuntime;
}

export async function disposeSharedCodexEvalRuntime(): Promise<void> {
  const runtime = sharedEvalRuntime;
  sharedEvalRuntime = undefined;
  if (runtime) {
    await runtime.dispose();
  }
}

export class CodexAgentDriver implements AgentDriver {
  readonly name = "pi-ling-codex-agent";
  readonly runtime = "codex";

  async run(
    worktree: string,
    task: TaskSpec,
    options: AgentRunOptions = {},
  ) {
    const started = Date.now();
    const prompt = effectivePrompt(task);
    const metrics = emptyMetrics();
    let response = "";
    let assistantChunks: string[] = [];
    let runError = "";
    let runFinished = false;
    let runSucceeded = false;

    const runtime = await sharedCodexEvalRuntime();
    const sessionId = randomUUID();
    const runId = `eval-${task.id}`;

    runtime.subscribe(async (event: RuntimeEvent) => {
      if (event.type === "permission") {
        const allowOption = event.options.find(
          (option) =>
            option.kind === "allow_once" || option.kind === "allow_always",
        );
        if (allowOption) {
          await runtime.resolvePermission({
            permissionId: event.permissionId,
            optionId: allowOption.optionId,
          });
          return;
        }
        metrics.approval_interrupts += 1;
        runError = "approval_required";
        runFinished = true;
        await runtime.cancel(sessionId);
        return;
      }
      if (event.type === "tool" && event.status === "running") {
        metrics.tool_calls += 1;
        assistantChunks = [];
        if (event.title === "run_command") {
          metrics.validation_calls += 1;
        }
      }
      if (event.type === "assistant_text") {
        assistantChunks.push(event.delta);
      }
      if (event.type === "run_end" && event.runId === runId) {
        runFinished = true;
        runSucceeded = event.status === "completed";
        if (event.status === "error") {
          runError = event.error ?? "codex run failed";
        }
        response = assistantChunks.join("");
      }
    });

    try {
      await runtime.createSession({
        sessionId,
        workspaceRoot: worktree,
        approvalPolicy: "never",
      });
      await runtime.send(sessionId, runId, prompt);
      await waitUntil(() => runFinished, {
        ...options,
        onTimeout: () => {
          void runtime.cancel(sessionId);
          runError = "timeout";
          runFinished = true;
        },
      });
      if (options.abortSignal?.aborted && !runFinished) {
        runError = "cancelled";
        runFinished = true;
        await runtime.cancel(sessionId);
      }
      await runtime.closeSession(sessionId);
    } catch (error) {
      runError = error instanceof Error ? error.message : String(error);
      runFinished = true;
      await runtime.closeSession(sessionId).catch(() => {});
    }

    const durationMs = Date.now() - started;
    if (!runSucceeded) {
      return {
        action: {
          name: "codex-agent",
          command: prompt,
          exit_code: -1,
          duration_ms: durationMs,
          stderr: runError || "codex run did not complete successfully",
          ...(runError === "timeout" ? { timed_out: true } : {}),
        },
        metrics,
        error: runError || "codex run did not complete successfully",
      };
    }

    return {
      action: {
        name: "codex-agent",
        command: prompt,
        exit_code: 0,
        duration_ms: durationMs,
      },
      metrics,
      ...(response ? { response } : {}),
    };
  }
}
