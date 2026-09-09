export const RESPONSE_FILE_NAME = ".eval-response.txt";

export interface BaselineSpec {
  included: boolean;
  reason: string;
}

export interface FixtureSpec {
  files: Record<string, string>;
  command: string;
}

export interface VerifyCommand {
  name: string;
  command: string;
}

export interface ScoringPolicy {
  forbidden_paths: string[];
  max_changed_files: number;
  max_added_lines: number;
  max_deleted_lines: number;
}

export interface JudgeSpec {
  type: "llm";
  target: string;
  rubric: string;
}

export interface TaskSpec {
  id: string;
  title: string;
  description: string;
  prompt?: string;
  type: "fixture";
  difficulty?: "smoke" | "medium" | "hard";
  enabled: boolean;
  disabled_reason?: string;
  baseline: BaselineSpec;
  timeout_seconds: number;
  fixture: FixtureSpec;
  verify: VerifyCommand[];
  scoring: ScoringPolicy;
  judge?: JudgeSpec;
}

export interface Catalog {
  version: number;
  tasks: TaskSpec[];
}

export interface CommandResult {
  name: string;
  command: string;
  exit_code: number;
  duration_ms: number;
  timed_out?: boolean;
  stdout?: string;
  stderr?: string;
}

export interface DiffStat {
  changed_files: number;
  added_lines: number;
  deleted_lines: number;
  paths: string[];
}

export interface Score {
  passed: boolean;
  violations: string[];
  diff: DiffStat;
}

export interface AgentMetrics {
  tool_calls: number;
  validation_calls: number;
  completion_gate_runs: number;
  approval_interrupts: number;
}

export interface ExperimentRun {
  experiment: string;
  variant: string;
  iteration: number;
}

export interface JudgeResult {
  score: number;
  rationale?: string;
  model?: string;
  error?: string;
}

export type RunStatus = "passed" | "failed" | "skipped" | "error";

export interface RunResult {
  task_id: string;
  title: string;
  driver: string;
  runtime?: string;
  experiment_run?: ExperimentRun;
  approval_mode?: string;
  started_at: string;
  duration_ms: number;
  status: RunStatus;
  error?: string;
  worktree?: string;
  action: CommandResult;
  verification: CommandResult[];
  score: Score;
  judge?: JudgeResult;
  metrics?: AgentMetrics;
}

export interface LedgerSummary {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  errors: number;
}

export interface MeanDelta {
  baseline: number;
  candidate: number;
  delta: number;
}

export interface MetricsComparison {
  duration_ms: MeanDelta;
  tool_calls: MeanDelta;
  validation_calls: MeanDelta;
  completion_gate_runs: MeanDelta;
  approval_interrupts: MeanDelta;
  judge_score: MeanDelta;
  judge_pairs: number;
}

export interface ComparisonSummary {
  experiment: string;
  baseline: string;
  candidate: string;
  baseline_samples: number;
  candidate_samples: number;
  pairs: number;
  baseline_pass_rate: number;
  candidate_pass_rate: number;
  pass_rate_lift: number;
  metrics: MetricsComparison;
  diagnostics: string[];
}

export type EvalDriver = "reference" | "noop" | "agent";
export type EvalRuntime = "native" | "dsh";
