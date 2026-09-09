import type { TimelineItem, TimelineRun, ToolTimelineItem } from "../timeline/reducer";
import { editToolCallIds } from "./run-changes";
import { isExitPlanModeTool } from "../features/plans/project-session-plans";
import {
  classifyTool,
  toolAction,
  toolTarget,
} from "./tool-taxonomy";
import type {
  RunActivityCounters,
  RunActivityModel,
  RunPhase,
} from "./types";
import { projectRunTodos } from "./project-run-todos";

function exploreTarget(tool: ToolTimelineItem): string | undefined {
  const target = toolTarget(tool).trim();
  return target
    ? target.replaceAll("\\", "/").toLowerCase()
    : undefined;
}

function summary(counters: RunActivityCounters): string {
  const parts: string[] = [];
  if (counters.editedFiles.length) {
    parts.push(
      `edited ${counters.editedFiles.length} ${
        counters.editedFiles.length === 1 ? "file" : "files"
      }`,
    );
  }
  if (counters.exploredFiles.length) {
    parts.push(
      `explored ${counters.exploredFiles.length} ${
        counters.exploredFiles.length === 1 ? "file" : "files"
      }`,
    );
  }
  if (counters.commandCount) {
    parts.push(
      `ran ${counters.commandCount} ${
        counters.commandCount === 1 ? "command" : "commands"
      }`,
    );
  }
  if (parts.length === 0 && counters.toolCount) {
    parts.push(
      `used ${counters.toolCount} ${counters.toolCount === 1 ? "tool" : "tools"}`,
    );
  }
  if (parts.length === 0) return "";
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function terminalPhase(status: TimelineRun["status"]): RunPhase | undefined {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "error" || status === "crashed") return "failed";
  return undefined;
}

export function projectRunActivities(input: {
  items: readonly TimelineItem[];
  runs: Readonly<Record<string, TimelineRun>>;
  presentingMessageIds?: ReadonlySet<string>;
  presentingRunIds?: ReadonlySet<string>;
  visibleToolIds?: ReadonlySet<string>;
  currentToolId?: string;
}): RunActivityModel[] {
  const order: string[] = [];
  const grouped = new Map<string, TimelineItem[]>();
  for (const item of input.items) {
    if (!grouped.has(item.runId)) order.push(item.runId);
    const items = grouped.get(item.runId) ?? [];
    items.push(item);
    grouped.set(item.runId, items);
  }

  return order.map((runId) => {
    const items = grouped.get(runId)!;
    const allTools = items
      .filter((item) => item.kind === "tool")
      .sort((a, b) => a.createdSeq - b.createdSeq);
    const tools = input.visibleToolIds
      ? allTools.filter((tool) => input.visibleToolIds!.has(tool.id))
      : allTools;
    const approvals = items
      .filter((item) => item.kind === "approval")
      .sort((a, b) => a.createdSeq - b.createdSeq);
    const allChanges = items
      .filter((item) => item.kind === "changes")
      .sort((a, b) => a.createdSeq - b.createdSeq);
    const editCallIds = editToolCallIds(items, runId);
    const changes = (
      input.visibleToolIds
        ? allChanges.filter((change) =>
            input.visibleToolIds!.has(change.callId),
          )
        : allChanges
    ).filter((change) => editCallIds.has(change.callId));
    const assistants = items
      .filter((item) => item.kind === "assistant")
      .sort((a, b) => a.createdSeq - b.createdSeq);
    const user = items.find((item) => item.kind === "user");
    const edited = new Set<string>();
    const explored = new Set<string>();
    let commandCount = 0;
    for (const tool of tools) {
      if (
        tool.status !== "completed" &&
        tool.status !== "running"
      ) {
        continue;
      }
      const category = classifyTool(tool);
      const target = exploreTarget(tool);
      if (category === "edit" && target) edited.add(target);
      if (category === "explore" && target) explored.add(target);
      if (category === "command" || category === "verify") commandCount += 1;
    }
    let additions: number | undefined;
    let deletions: number | undefined;
    for (const change of changes) {
      for (const file of change.files) {
        if (file.additions !== undefined) {
          additions = (additions ?? 0) + file.additions;
        }
        if (file.deletions !== undefined) {
          deletions = (deletions ?? 0) + file.deletions;
        }
      }
    }
    const counters: RunActivityCounters = {
      editedFiles: [...edited],
      exploredFiles: [...explored],
      commandCount,
      toolCount: tools.length,
      failedToolCount: tools.filter(
        (tool) => tool.status === "failed" || tool.status === "denied",
      ).length,
      approvalCount: approvals.length,
      pendingApprovalCount: approvals.filter(
        (approval) => approval.status === "pending",
      ).length,
      ...(additions !== undefined ? { additions } : {}),
      ...(deletions !== undefined ? { deletions } : {}),
    };
    const lifecycle = input.runs[runId]?.status ?? "completed";
    const hasPendingPresentation =
      input.presentingRunIds?.has(runId) ||
      assistants.some((assistant) =>
        input.presentingMessageIds?.has(assistant.id),
      );
    const viewMode =
      lifecycle === "running" || hasPendingPresentation
        ? "active"
        : "settled";
    const pendingApproval = [...approvals]
      .reverse()
      .find((approval) => approval.status === "pending");
    const currentTool = input.currentToolId
      ? allTools.find((tool) => tool.id === input.currentToolId)
      : undefined;
    const activeTool =
      currentTool ??
      [...tools]
        .reverse()
        .find((tool) =>
          ["awaiting-approval", "running"].includes(tool.status),
        );
    let phase: RunPhase;
    let currentAction: RunActivityModel["currentAction"];
    const terminal = terminalPhase(lifecycle);
    if (terminal && viewMode === "settled") {
      phase = terminal;
    } else if (
      pendingApproval &&
      !isExitPlanModeTool(pendingApproval.approval.tool)
    ) {
      phase = "awaiting_approval";
      const effect = pendingApproval.approval.effect;
      currentAction = {
        verb: "Approval required",
        target: String(
          effect["path"] ??
            effect["command"] ??
            pendingApproval.approval.tool,
        ),
        toolItemId: pendingApproval.toolItemId,
      };
    } else if (activeTool) {
      const category = classifyTool(activeTool);
      phase =
        category === "verify"
          ? "verifying"
          : category === "edit"
            ? "editing"
            : category === "explore" || category === "network"
              ? "exploring"
              : category === "command" || category === "agent"
                ? "running"
                : "planning";
      currentAction = {
        ...toolAction(activeTool),
        toolItemId: activeTool.id,
      };
    } else {
      phase = "planning";
    }
    const segments = assistants.map((assistant) => ({
      turnId: assistant.turnId,
      content: assistant.text,
      assistant,
      tools: tools.filter((tool) => tool.turnId === assistant.turnId),
    }));
    const hasUnsettledWork = allTools.some((tool) =>
      ["requested", "awaiting-approval", "running"].includes(tool.status),
    );
    const lastSegment = segments.at(-1);
    const finalAssistant =
      lifecycle !== "running" &&
      !hasUnsettledWork &&
      !pendingApproval &&
      lastSegment &&
      lastSegment.tools.length === 0 &&
      lastSegment.content.trim() &&
      lastSegment.assistant.stopReason !== undefined &&
      lastSegment.assistant.stopReason !== "toolUse"
        ? lastSegment.assistant
        : undefined;
    const workSegments = finalAssistant
      ? segments.slice(0, -1)
      : segments;
    const thinking = assistants
      .map((assistant) => assistant.thinking.trim())
      .filter(Boolean)
      .join("\n\n");
    const todos = projectRunTodos(items, runId) ?? undefined;
    const hasActivity =
      lifecycle === "running" ||
      allTools.length > 0 ||
      approvals.length > 0 ||
      changes.length > 0 ||
      Boolean(thinking) ||
      assistants.some((assistant) => assistant.stopReason === "toolUse");
    const todoAction =
      lifecycle === "running" && todos?.inProgress
        ? {
            verb: "Working on",
            target: todos.inProgress.content,
          }
        : undefined;
    return {
      runId,
      ...(user?.kind === "user" ? { user } : {}),
      lifecycle,
      viewMode,
      phase,
      ...(todoAction ?? (currentAction ? { currentAction } : {})),
      counters,
      summary: summary(counters),
      tools,
      approvals,
      changes,
      thinking,
      segments,
      workSegments,
      hasUnsettledWork,
      ...(finalAssistant ? { finalAssistant } : {}),
      hasActivity,
      hasBlockingApproval: counters.pendingApprovalCount > 0,
      ...(todos ? { todos } : {}),
    };
  });
}

export function activityPhaseLabel(phase: RunPhase): string {
  return {
    planning: "Planning next steps",
    exploring: "Exploring codebase",
    editing: "Editing files",
    running: "Running command",
    verifying: "Running verification",
    awaiting_approval: "Waiting for approval",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  }[phase];
}
