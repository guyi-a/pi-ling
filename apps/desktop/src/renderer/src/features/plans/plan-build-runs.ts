import type { TimelineItem } from "../../timeline/reducer";

import {
  extractPlanText,
  isNativePlanPresentationTool,
} from "./project-session-plans";

const STORAGE_PREFIX = "pi-ling.plan-build-runs.";
const BUILD_PROMPT_PREFIX = "请执行以下已批准方案";

export function planBuildRunsStorageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

export function readPlanBuildRuns(
  sessionId: string | null,
): Map<string, string> {
  if (!sessionId || typeof sessionStorage === "undefined") {
    return new Map();
  }
  try {
    const raw = sessionStorage.getItem(planBuildRunsStorageKey(sessionId));
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, string>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

export function writePlanBuildRun(
  sessionId: string,
  planRunId: string,
  buildRunId: string,
): Map<string, string> {
  const next = readPlanBuildRuns(sessionId);
  next.set(planRunId, buildRunId);
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(
      planBuildRunsStorageKey(sessionId),
      JSON.stringify(Object.fromEntries(next)),
    );
  }
  return next;
}

export function isBuildPlanPromptText(text: string): boolean {
  return text.trimStart().startsWith(BUILD_PROMPT_PREFIX);
}

export function extractBuildPlanMarkdown(text: string): string | null {
  if (!isBuildPlanPromptText(text)) return null;
  const marker = "\n\n";
  const index = text.indexOf(marker);
  if (index === -1) return null;
  const markdown = text.slice(index + marker.length).trim();
  return markdown || null;
}

export function inferPlanBuildRunsFromTimeline(
  items: readonly TimelineItem[],
): Map<string, string> {
  const planMarkdownByRun = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== "tool" || !isNativePlanPresentationTool(item.tool)) {
      continue;
    }
    const markdown = extractPlanText(item);
    if (markdown) {
      planMarkdownByRun.set(item.runId, markdown);
    }
  }

  const result = new Map<string, string>();
  for (const item of items) {
    if (item.kind !== "user") continue;
    const markdown = extractBuildPlanMarkdown(item.text);
    if (!markdown) continue;

    for (const [planRunId, planMarkdown] of planMarkdownByRun) {
      if (planRunId === item.runId) continue;
      if (planMarkdown.trim() === markdown.trim()) {
        result.set(planRunId, item.runId);
      }
    }
  }

  return result;
}

export function resolvePlanBuildRuns(
  sessionId: string | null,
  items: readonly TimelineItem[],
): Map<string, string> {
  const inferred = inferPlanBuildRunsFromTimeline(items);
  const stored = readPlanBuildRuns(sessionId);
  return new Map([...inferred, ...stored]);
}

export function buildPlanPrompt(markdown: string): string {
  return `${BUILD_PROMPT_PREFIX}。按步骤实施，用 todo_write 跟踪进度。\n\n${markdown}`;
}
