import type { SubagentSpec } from "@pi-ling/contracts";

export type SpawnedSubagent = {
  childSessionId: string;
  childRunId: string;
};

export type SubagentResult = SpawnedSubagent & {
  summary: string;
};

export type BackgroundSubagentResult = {
  taskId: string;
  status: "pending" | "running";
};

export type SubagentSpawnResult = SubagentResult | BackgroundSubagentResult;

export type SubagentInvocationContext = {
  parentToolCallId: string;
  signal?: AbortSignal;
};

export type SubagentRuntime = {
  spawn(
    spec: SubagentSpec,
    context: SubagentInvocationContext,
  ): Promise<SubagentSpawnResult>;
};
