import type { ChangedFile } from "@pi-ling/contracts";

import type {
  ChangesTimelineItem,
  TimelineItem,
  TimelineRun,
  ToolTimelineItem,
} from "../timeline/reducer";
import { classifyTool } from "./tool-taxonomy";

/**
 * 从 timeline 中按「最新有改动的 run」聚合出 Last Agent Turn 的文件改动。
 * 采用累计语义：匹配到最新 runId 后，把该 run 内所有 `changes` 事件的 files 合并，
 * 以 path 去重（后发生的覆盖前面的 status/统计）。
 */
export function lastAgentTurnChanges(
  items: readonly TimelineItem[],
  runs: Readonly<Record<string, TimelineRun>>,
): ChangedFile[] {
  const changesItems = items.filter(
    (item): item is ChangesTimelineItem => item.kind === "changes",
  );
  if (changesItems.length === 0) return [];

  // 选拥有最大 createdSeq 的 changes 事件所属 runId（即当前/最新 run）。
  const latest = changesItems.reduce((left, right) =>
    left.createdSeq >= right.createdSeq ? left : right,
  );
  const runId = latest.runId;

  const byPath = new Map<string, ChangedFile>();
  for (const item of changesItems) {
    if (item.runId !== runId) continue;
    for (const file of item.files) {
      byPath.set(file.path, file);
    }
  }
  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

/**
 * 用会话级净改动（ChangeTracker / getChanges agent）校正 Last Agent Turn。
 * 同一轮里「先 create 再 delete」时 timeline 仍保留 added 快照，但磁盘/net 已无改动。
 */
export function reconcileLastAgentTurnChanges(
  turnFiles: readonly ChangedFile[],
  netFiles: readonly ChangedFile[],
): ChangedFile[] {
  if (turnFiles.length === 0) return [];
  const netByPath = new Map(netFiles.map((file) => [file.path, file]));
  return turnFiles
    .map((file) => netByPath.get(file.path))
    .filter((file): file is ChangedFile => file !== undefined)
    .sort((left, right) => left.path.localeCompare(right.path));
}

export function editToolCallIds(
  items: readonly TimelineItem[],
  runId: string,
): Set<string> {
  return new Set(
    items
      .filter(
        (item): item is ToolTimelineItem =>
          item.kind === "tool" &&
          item.runId === runId &&
          item.status !== "denied" &&
          item.status !== "cancelled",
      )
      .filter((tool) => classifyTool(tool) === "edit")
      .map((tool) => tool.callId),
  );
}

export function changesFilesByRunId(
  items: readonly TimelineItem[],
  runId: string,
  options?: { editToolsOnly?: boolean },
): ChangedFile[] {
  const editCallIds = options?.editToolsOnly
    ? editToolCallIds(items, runId)
    : undefined;
  const byPath = new Map<string, ChangedFile>();
  for (const item of items) {
    if (item.kind !== "changes" || item.runId !== runId) continue;
    if (editCallIds && !editCallIds.has(item.callId)) continue;
    for (const file of item.files) {
      byPath.set(file.path, file);
    }
  }
  return [...byPath.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}
