import type { ChangedFile } from "@pi-ling/contracts";

/**
 * 文件树 git 装饰状态。
 * `untracked` 与 `added` 颜色一致（绿），仅字母不同（U / A），对齐 VS Code 习惯。
 */
export type GitDecorationState =
  | "untracked"
  | "added"
  | "modified"
  | "deleted";

export interface GitDecorations {
  /** 文件相对路径 → 状态 */
  files: ReadonlyMap<string, GitDecorationState>;
  /** 目录相对路径（以 "/" 结尾）→ 子树内聚合状态 */
  dirs: ReadonlyMap<string, GitDecorationState>;
}

export const EMPTY_GIT_DECORATIONS: GitDecorations = {
  files: new Map(),
  dirs: new Map(),
};

export const GIT_DECORATION_LETTER: Record<GitDecorationState, string> = {
  untracked: "U",
  added: "A",
  modified: "M",
  deleted: "D",
};

export const GIT_DECORATION_LABEL: Record<GitDecorationState, string> = {
  untracked: "未跟踪",
  added: "已暂存的新增",
  modified: "已修改",
  deleted: "已删除",
};

/** 目录聚合优先级：删除 > 修改 > 新增/未跟踪 */
const DIR_PRIORITY: Record<GitDecorationState, number> = {
  deleted: 3,
  modified: 2,
  added: 1,
  untracked: 1,
};

export function decorationForFile(file: ChangedFile): GitDecorationState {
  if (file.status === "deleted") return "deleted";
  if (file.status === "modified") return "modified";
  return file.staged ? "added" : "untracked";
}

export function buildGitDecorations(
  files: readonly ChangedFile[],
): GitDecorations {
  const fileStates = new Map<string, GitDecorationState>();
  const dirStates = new Map<string, GitDecorationState>();
  for (const file of files) {
    const state = decorationForFile(file);
    fileStates.set(file.path, state);
    for (const dir of ancestorDirectories(file.path)) {
      const current = dirStates.get(dir);
      if (!current || DIR_PRIORITY[state] > DIR_PRIORITY[current]) {
        dirStates.set(dir, state);
      }
    }
  }
  return { files: fileStates, dirs: dirStates };
}

/** "a/b/c.ts" → ["a/", "a/b/"] */
function ancestorDirectories(path: string): string[] {
  const segments = path.split("/");
  segments.pop();
  const dirs: string[] = [];
  let prefix = "";
  for (const segment of segments) {
    prefix += `${segment}/`;
    dirs.push(prefix);
  }
  return dirs;
}
