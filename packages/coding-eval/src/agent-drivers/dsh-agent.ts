import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { DshRuntimeAdapter } from "@pi-ling/dsh-runtime";
import type { RuntimeEvent } from "@pi-ling/runtime-contracts";

import { effectivePrompt } from "../manifest.js";
import type { AgentMetrics, TaskSpec } from "../types.js";
import { buildDshRuntimeOptions } from "./dsh-env.js";
import type { AgentDriver, AgentRunOptions } from "./types.js";

function emptyMetrics(): AgentMetrics {
  return {
    tool_calls: 0,
    validation_calls: 0,
    completion_gate_runs: 0,
    approval_interrupts: 0,
  };
}

export class DshAgentDriver implements AgentDriver {
  readonly name = "pi-ling-dsh-agent";
  readonly runtime = "dsh";

  async run(
    worktree: string,
    task: TaskSpec,
    timeoutMs: number,
    _options: AgentRunOptions = {},
  ) {
    const started = Date.now();
    const prompt = effectivePrompt(task);
    const metrics = emptyMetrics();
    let response = "";
    let assistantChunks: string[] = [];
    let runError = "";
    let runFinished = false;
    let runSucceeded = false;

    const dshHome = await mkdtemp(join(tmpdir(), "pi-ling-dsh-eval-home-"));
    const runtime = new DshRuntimeAdapter(buildDshRuntimeOptions(dshHome));
    const sessionId = randomUUID();
    const runId = `eval-${task.id}`;

    runtime.subscribe(async (event: RuntimeEvent) => {
      if (event.type === "permission") {
        metrics.approval_interrupts += 1;
        runError = "approval_required";
        runFinished = true;
        await runtime.cancel(sessionId);
        return;
      }
      if (event.type === "tool") {
        if (event.status === "running") {
          metrics.tool_calls += 1;
          assistantChunks = [];
          if (event.title === "run_command") {
            metrics.validation_calls += 1;
          }
        }
      }
      if (event.type === "assistant_text") {
        assistantChunks.push(event.delta);
      }
      if (event.type === "run_end" && event.runId === runId) {
        runFinished = true;
        runSucceeded = event.status === "completed";
        if (event.status === "error") {
          runError = event.error ?? "dsh run failed";
        }
        response = assistantChunks.join("");
      }
    });

    try {
      await runtime.initialize();
      await runtime.createSession({
        sessionId,
        workspaceRoot: worktree,
      });
      const timer = setTimeout(() => {
        void runtime.cancel(sessionId);
        runError = "timeout";
        runFinished = true;
      }, timeoutMs);
      try {
        await runtime.send(sessionId, runId, prompt);
      } finally {
        clearTimeout(timer);
      }
      const deadline = Date.now() + 5_000;
      while (!runFinished && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      await runtime.closeSession(sessionId);
    } catch (error) {
      runError = error instanceof Error ? error.message : String(error);
      runFinished = true;
    } finally {
      await runtime.dispose();
      await rm(dshHome, { recursive: true, force: true });
    }

    const durationMs = Date.now() - started;
    if (!runSucceeded) {
      return {
        action: {
          name: "dsh-agent",
          command: prompt,
          exit_code: -1,
          duration_ms: durationMs,
          stderr: runError || "dsh run did not complete successfully",
          ...(runError === "timeout" ? { timed_out: true } : {}),
        },
        metrics,
        error: runError || "dsh run did not complete successfully",
      };
    }

    return {
      action: {
        name: "dsh-agent",
        command: prompt,
        exit_code: 0,
        duration_ms: durationMs,
      },
      metrics,
      ...(response ? { response } : {}),
    };
  }
}
