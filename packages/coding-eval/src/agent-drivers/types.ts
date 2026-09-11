import type { AgentMetrics, CommandResult, TaskSpec } from "../types.js";

export interface AgentActionResult {
  action: CommandResult;
  metrics: AgentMetrics;
  response?: string;
  error?: string;
}

export interface AgentRunOptions {
  abortSignal?: AbortSignal;
}

export interface AgentDriver {
  readonly name: string;
  readonly runtime: string;
  run(
    worktree: string,
    task: TaskSpec,
    options?: AgentRunOptions,
  ): Promise<AgentActionResult>;
}
