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
 *
 * **以该 run 内最后一个 `changes` 快照为准**，不是把各次快照求并集。
 * 原因：`changes` 事件携带的是 `ChangeTracker.changedFiles()` —— 一个会话级
 * **累计**快照（每次文件改动后重算全量）。既然如此，最后一份就是该 run 结束时的
 * 权威状态；求并集反而会把「先建后删、已回退」的文件永远留在列表里。
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

  return latestSnapshotFiles(changesItems, runId);
}

/**
 * 取某个 run 内最后一个 changes 快照的文件，按路径排序。
 *
 * `editCallIds` 给定时只考虑这些工具发出的快照（用于「只看编辑类工具」的场景）。
 */
function latestSnapshotFiles(
  changesItems: readonly ChangesTimelineItem[],
  runId: string,
  editCallIds?: ReadonlySet<string>,
): ChangedFile[] {
  let latest: ChangesTimelineItem | undefined;
  for (const item of changesItems) {
    if (item.runId !== runId) continue;
    if (editCallIds && !editCallIds.has(item.callId)) continue;
    if (!latest || item.createdSeq >= latest.createdSeq) latest = item;
  }
  if (!latest) return [];
  return [...latest.files].sort((left, right) =>
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
  const changesItems = items.filter(
    (item): item is ChangesTimelineItem => item.kind === "changes",
  );
  const editCallIds = options?.editToolsOnly
    ? editToolCallIds(items, runId)
    : undefined;
  // 同样以「最后一个累计快照」为准，理由见 lastAgentTurnChanges 的注释
  return latestSnapshotFiles(changesItems, runId, editCallIds);
}
