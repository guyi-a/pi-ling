import type { ChangedFile } from "@pi-ling/contracts";
import { GitBranch, GitCommit, Layers, StickyNote, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ChangesSourceId =
  | "last-agent-turn"
  | "uncommitted"
  | "staged"
  | "unstaged"
  | "commits";

export interface ChangesSourceDef {
  id: ChangesSourceId;
  label: string;
  icon: LucideIcon;
  /** 本期是否有真实数据；false 则灰置占位 */
  enabled: boolean;
  description: string;
}

export const CHANGES_SOURCES: ChangesSourceDef[] = [
  {
    id: "last-agent-turn",
    label: "Last Agent Turn",
    icon: GitBranch,
    enabled: true,
    description: "本次 Agent 运行产生的改动",
  },
  {
    id: "uncommitted",
    label: "Uncommitted",
    icon: StickyNote,
    enabled: true,
    description: "工作区相对会话基线的全部改动",
  },
  {
    id: "staged",
    label: "Staged",
    icon: Layers,
    enabled: false,
    description: "已暂存改动（即将上线）",
  },
  {
    id: "unstaged",
    label: "Unstaged",
    icon: Upload,
    enabled: false,
    description: "未暂存改动（即将上线）",
  },
  {
    id: "commits",
    label: "Commits",
    icon: GitCommit,
    enabled: false,
    description: "提交记录（即将上线）",
  },
];

export function sourceDef(id: ChangesSourceId): ChangesSourceDef {
  return CHANGES_SOURCES.find((source) => source.id === id)!;
}

export function sumChanges(files: readonly ChangedFile[]): {
  additions: number;
  deletions: number;
} {
  let additions = 0;
  let deletions = 0;
  for (const file of files) {
    additions += file.additions ?? 0;
    deletions += file.deletions ?? 0;
  }
  return { additions, deletions };
}

export const DEFAULT_CHANGES_SOURCE: ChangesSourceId = "uncommitted";

