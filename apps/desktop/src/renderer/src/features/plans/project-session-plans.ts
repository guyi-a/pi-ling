import type { RuntimeKind } from "@pi-ling/contracts";

import type {
  ApprovalTimelineItem,
  TimelineItem,
  TimelineRun,
  ToolTimelineItem,
} from "../../timeline/reducer";

import type { PlansRunFilter, SessionPlan, SessionPlanStatus } from "./types";

export const PLAN_TOOL_PATTERN =
  /exit_plan_mode|^plan$|update_plan|create_plan/;

const NATIVE_PLAN_TOOL_PATTERN = /update_plan|create_plan/;

export function isPlanToolName(name: string): boolean {
  return PLAN_TOOL_PATTERN.test(name.trim().toLowerCase());
}

export function isExitPlanModeTool(name: string): boolean {
  return name.trim().toLowerCase() === "exit_plan_mode";
}

export function isNativePlanPresentationTool(name: string): boolean {
  return NATIVE_PLAN_TOOL_PATTERN.test(name.trim().toLowerCase());
}

export function extractPlanText(
  item: Pick<ToolTimelineItem, "arguments" | "output">,
): string {
  const args = item.arguments;
  for (const key of [
    "plan",
    "content",
    "text",
    "body",
    "summary",
    "markdown",
    "steps",
  ]) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  if (typeof item.output === "string" && item.output.trim()) {
    return item.output.trim();
  }
  return "";
}

function findExitPlanTool(
  items: readonly TimelineItem[],
  runId: string,
): ToolTimelineItem | undefined {
  let latest: ToolTimelineItem | undefined;
  for (const item of items) {
    if (
      item.kind !== "tool" ||
      item.runId !== runId ||
      !isExitPlanModeTool(item.tool)
    ) {
      continue;
    }
    if (!latest || item.createdSeq >= latest.createdSeq) {
      latest = item;
    }
  }
  return latest;
}

function findLatestNativePlanTool(
  items: readonly TimelineItem[],
  runId: string,
): ToolTimelineItem | undefined {
  let latest: ToolTimelineItem | undefined;
  for (const item of items) {
    if (
      item.kind !== "tool" ||
      item.runId !== runId ||
      !isNativePlanPresentationTool(item.tool)
    ) {
      continue;
    }
    if (!latest || item.createdSeq >= latest.createdSeq) {
      latest = item;
    }
  }
  return latest;
}

function findPendingExitApproval(
  items: readonly TimelineItem[],
  runId: string,
  exitCallId: string,
): ApprovalTimelineItem | undefined {
  for (const item of items) {
    if (item.kind !== "approval" || item.runId !== runId) continue;
    if (item.status !== "pending") continue;
    if (
      item.approval.callId === exitCallId ||
      item.toolItemId === exitCallId
    ) {
      return item;
    }
  }
  return undefined;
}

function resolveDshPlanStatus(
  plan: SessionPlan,
  items: readonly TimelineItem[],
  runs: Readonly<Record<string, TimelineRun>>,
): SessionPlanStatus {
  const exitTool = plan.exitCallId
    ? items.find(
        (item): item is ToolTimelineItem =>
          item.kind === "tool" &&
          item.runId === plan.runId &&
          item.callId === plan.exitCallId,
      )
    : findExitPlanTool(items, plan.runId);

  if (!exitTool) {
    return plan.markdown ? "draft" : "draft";
  }

  const pending = findPendingExitApproval(items, plan.runId, exitTool.callId);
  if (
    pending ||
    exitTool.status === "awaiting-approval" ||
    exitTool.status === "requested"
  ) {
    return "ready";
  }

  if (exitTool.status === "denied") {
    return "rejected";
  }

  const deniedApproval = items.find(
    (item): item is ApprovalTimelineItem =>
      item.kind === "approval" &&
      item.runId === plan.runId &&
      item.approval.callId === exitTool.callId &&
      item.status === "denied",
  );
  if (deniedApproval) {
    return "rejected";
  }

  if (exitTool.status === "completed") {
    const runStatus = runs[plan.runId]?.status;
    return runStatus === "completed" ? "built" : "building";
  }

  if (exitTool.status === "running") {
    return "building";
  }

  if (exitTool.status === "failed") {
    return runs[plan.runId]?.status === "running" ? "ready" : "draft";
  }

  return plan.markdown ? "draft" : "draft";
}

function resolveNativePlanStatus(
  plan: SessionPlan,
  items: readonly TimelineItem[],
  runs: Readonly<Record<string, TimelineRun>>,
): SessionPlanStatus {
  const buildRunId = plan.buildRunId;
  if (buildRunId) {
    const buildStatus = runs[buildRunId]?.status;
    if (buildStatus === "running") return "building";
    if (buildStatus === "completed") return "built";
    if (
      buildStatus === "cancelled" ||
      buildStatus === "error" ||
      buildStatus === "crashed"
    ) {
      return "ready";
    }
  }

  if (!plan.markdown) return "draft";

  const planningRunStatus = runs[plan.runId]?.status;
  const latestPlanTool = findLatestNativePlanTool(items, plan.runId);
  if (!latestPlanTool || latestPlanTool.status !== "completed") {
    return "draft";
  }

  if (planningRunStatus === "running") return "draft";
  if (planningRunStatus === "completed" && !buildRunId) return "ready";
  if (planningRunStatus === "completed" && buildRunId) {
    return runs[buildRunId]?.status === "running" ? "building" : "built";
  }

  return "draft";
}

function resolveCodexPlanStatus(
  plan: SessionPlan,
  items: readonly TimelineItem[],
  runs: Readonly<Record<string, TimelineRun>>,
): SessionPlanStatus {
  return resolveNativePlanStatus(plan, items, runs);
}

function resolvePlanStatus(
  plan: SessionPlan,
  items: readonly TimelineItem[],
  runs: Readonly<Record<string, TimelineRun>>,
  runtimeKind?: RuntimeKind,
): SessionPlanStatus {
  if (runtimeKind === "codex") {
    return resolveCodexPlanStatus(plan, items, runs);
  }
  if (plan.exitCallId || findExitPlanTool(items, plan.runId)) {
    return resolveDshPlanStatus(plan, items, runs);
  }
  return resolveNativePlanStatus(plan, items, runs);
}

export interface ProjectSessionPlansOptions {
  buildRunByPlanRunId?: ReadonlyMap<string, string>;
  runtimeKind?: RuntimeKind;
}

export function projectSessionPlans(
  items: readonly TimelineItem[],
  runs: Readonly<Record<string, TimelineRun>> = {},
  options: ProjectSessionPlansOptions = {},
): Map<string, SessionPlan> {
  const byRun = new Map<string, SessionPlan>();

  for (const item of items) {
    if (item.kind !== "tool" || !isPlanToolName(item.tool)) continue;

    const normalized = item.tool.trim().toLowerCase();
    const isExit = normalized === "exit_plan_mode";
    const text = extractPlanText(item);

    let plan = byRun.get(item.runId);
    if (!plan) {
      plan = {
        planId: item.callId,
        runId: item.runId,
        source: "tool",
        format: "markdown",
        markdown: "",
        toolName: item.tool,
        status: "draft",
        updatedAt: item.createdSeq,
      };
      byRun.set(item.runId, plan);
    }

    if (text) {
      plan.markdown = text;
      plan.planId = item.callId;
      plan.toolName = item.tool;
    }
    if (isExit) {
      plan.exitCallId = item.callId;
      plan.toolName = item.tool;
      plan.planId = item.callId;
    }
    plan.updatedAt = item.createdSeq;
  }

  for (const plan of byRun.values()) {
    plan.buildRunId = options.buildRunByPlanRunId?.get(plan.runId);
    plan.status = resolvePlanStatus(
      plan,
      items,
      runs,
      options.runtimeKind,
    );
    plan.pendingApproval = undefined;
    if (plan.status === "ready" && plan.exitCallId) {
      const pending = findPendingExitApproval(
        items,
        plan.runId,
        plan.exitCallId,
      );
      if (pending) {
        plan.pendingApproval = {
          approvalItemId: pending.id,
          callId: pending.approval.callId,
          effectDigest: pending.approval.effectDigest,
        };
      }
    }
  }

  return byRun;
}

export function resolveActivePlanRunId(input: {
  runs: Readonly<Record<string, TimelineRun>>;
  activeRunId: string | null;
  plans: ReadonlyMap<string, SessionPlan>;
}): string | null {
  const running = Object.values(input.runs).find(
    (run) => run.status === "running",
  );
  if (running && input.plans.has(running.id)) return running.id;
  if (input.activeRunId && input.plans.has(input.activeRunId)) {
    return input.activeRunId;
  }

  let latest: SessionPlan | null = null;
  for (const plan of input.plans.values()) {
    if (!latest || plan.updatedAt > latest.updatedAt) {
      latest = plan;
    }
  }
  return latest?.runId ?? null;
}

export function selectSessionPlan(
  plans: ReadonlyMap<string, SessionPlan>,
  runs: Readonly<Record<string, TimelineRun>>,
  filter: PlansRunFilter,
  activeRunId: string | null,
): SessionPlan | null {
  if (plans.size === 0) return null;
  if (filter === "all") {
    const sorted = [...plans.values()].sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
    return sorted[0] ?? null;
  }
  const runId = resolveActivePlanRunId({ runs, activeRunId, plans });
  return runId ? (plans.get(runId) ?? null) : null;
}

export function shortRunId(runId: string): string {
  return runId.length <= 8 ? runId : runId.slice(0, 8);
}

export function planDisplayTitle(plan: SessionPlan): string {
  const markdown = plan.markdown.trim();
  const heading = markdown.match(/^#\s+(.+)$/m);
  if (heading?.[1]) return heading[1].trim();
  const firstLine = markdown
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (firstLine) {
    return firstLine.replace(/^#+\s*/, "").trim();
  }
  return `Plan · ${shortRunId(plan.runId)}`;
}

export function sortedSessionPlans(
  plans: ReadonlyMap<string, SessionPlan>,
): SessionPlan[] {
  return [...plans.values()].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
}

export function isPlanAwaitingBuild(
  items: readonly TimelineItem[],
): ToolTimelineItem | null {
  for (const item of items) {
    if (item.kind !== "tool" || !isExitPlanModeTool(item.tool)) continue;
    if (
      item.status === "awaiting-approval" ||
      item.status === "requested"
    ) {
      return item;
    }
  }
  return null;
}

export function findPlanReadyForBuild(input: {
  items: readonly TimelineItem[];
  runs: Readonly<Record<string, TimelineRun>>;
  runtimeKind: RuntimeKind;
  buildRunByPlanRunId?: ReadonlyMap<string, string>;
}): { runId: string; callId: string } | null {
  if (input.runtimeKind === "dsh") {
    const awaiting = isPlanAwaitingBuild(input.items);
    return awaiting
      ? { runId: awaiting.runId, callId: awaiting.callId }
      : null;
  }

  const plans = projectSessionPlans(input.items, input.runs, {
    runtimeKind: input.runtimeKind,
    buildRunByPlanRunId: input.buildRunByPlanRunId,
  });
  for (const plan of plans.values()) {
    if (plan.status === "ready") {
      return { runId: plan.runId, callId: plan.planId };
    }
  }
  return null;
}

export function planStatusLabel(status: SessionPlanStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "ready":
      return "Ready to build";
    case "building":
      return "Building";
    case "built":
      return "Built";
    case "rejected":
      return "Not built";
  }
}
