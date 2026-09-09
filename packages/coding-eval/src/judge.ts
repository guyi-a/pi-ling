import { readFileSync } from "node:fs";
import { join } from "node:path";

import { effectivePrompt } from "./manifest.js";
import { readResponseFile } from "./response-file.js";
import type { JudgeResult, RunResult, TaskSpec } from "./types.js";
import { firstEnv, loadDotenv } from "./env.js";

export interface JudgeInput {
  taskId: string;
  prompt: string;
  rubric: string;
  content: string;
}

export interface Judge {
  score(input: JudgeInput): Promise<JudgeResult>;
}

export interface JudgeConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
}

export function judgeConfigFromEnv(): JudgeConfig {
  loadDotenv();
  return {
    apiKey:
      firstEnv("CODING_EVAL_JUDGE_API_KEY", "DEEPSEEK_API_KEY") ?? "",
    baseUrl:
      firstEnv("CODING_EVAL_JUDGE_BASE_URL", "DEEPSEEK_BASE_URL") ??
      "https://api.deepseek.com",
    model:
      firstEnv("CODING_EVAL_JUDGE_MODEL", "COMPACTION_MODEL") ??
      "deepseek-chat",
    maxTokens: Number.parseInt(
      firstEnv("CODING_EVAL_JUDGE_MAX_TOKENS") ?? "1024",
      10,
    ),
    timeoutMs: Number.parseInt(
      firstEnv("CODING_EVAL_JUDGE_TIMEOUT_MS") ?? "60000",
      10,
    ),
  };
}

export function judgeEnabled(config: JudgeConfig): boolean {
  return Boolean(config.apiKey.trim() && config.model.trim());
}

export class LlmJudge implements Judge {
  constructor(private readonly config: JudgeConfig) {}

  async score(input: JudgeInput): Promise<JudgeResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const prompt = [
        "You are a strict evaluator. Score the candidate output from 0 to 1 using the rubric.",
        "Return JSON only: {\"score\": number, \"rationale\": string}",
        "",
        `Task prompt:\n${input.prompt}`,
        "",
        `Rubric:\n${input.rubric}`,
        "",
        `Candidate output:\n${input.content}`,
      ].join("\n");
      const response = await fetch(
        `${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0,
            max_tokens: this.config.maxTokens,
            response_format: { type: "json_object" },
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        return {
          score: 0,
          model: this.config.model,
          error: `judge model call: HTTP ${response.status}`,
        };
      }
      const payload = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = payload.choices?.[0]?.message?.content?.trim() ?? "";
      if (!content) {
        return {
          score: 0,
          model: this.config.model,
          error: "judge model call: empty content",
        };
      }
      const parsed = JSON.parse(content) as {
        score?: unknown;
        rationale?: unknown;
      };
      const score =
        typeof parsed.score === "number"
          ? Math.min(1, Math.max(0, parsed.score))
          : Number.NaN;
      if (!Number.isFinite(score)) {
        return {
          score: 0,
          model: this.config.model,
          error: "judge model call: invalid score",
        };
      }
      return {
        score,
        ...(typeof parsed.rationale === "string"
          ? { rationale: parsed.rationale }
          : {}),
        model: this.config.model,
      };
    } catch (error) {
      return {
        score: 0,
        model: this.config.model,
        error: `judge model call: ${error instanceof Error ? error.message : String(error)}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

function judgeContent(task: TaskSpec, worktree: string): string {
  if (!task.judge) return "";
  if (task.judge.target === "response") {
    return readResponseFile(worktree) ?? "";
  }
  if (task.judge.target.startsWith("file:")) {
    const relative = task.judge.target.slice("file:".length).trim();
    return readFileSync(join(worktree, ...relative.split("/")), "utf8");
  }
  return "";
}

export async function runJudge(
  judge: Judge,
  task: TaskSpec,
  worktree: string,
): Promise<JudgeResult> {
  if (!task.judge) {
    return { score: 0, error: "task has no judge spec" };
  }
  return judge.score({
    taskId: task.id,
    prompt: effectivePrompt(task),
    rubric: task.judge.rubric,
    content: judgeContent(task, worktree),
  });
}

export function applyJudgeThreshold(
  result: RunResult,
  threshold: number,
): void {
  if (threshold <= 0 || !result.judge || result.judge.error) return;
  if (result.judge.score < threshold) {
    result.status = "failed";
    result.error = `judge score ${result.judge.score} below threshold ${threshold}`;
  }
}
