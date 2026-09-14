import { useCallback } from "react";

import { useFilesStore } from "./store";

/**
 * Files 面板的路径约定与树有关，集中放这里，避免各处手拼字符串出错。
 *
 * 约定（与 main 进程的 `WorkspaceTreeNode.path` 一致）：
 * - 路径用 "/" 分隔
 * - **目录以 "/" 结尾**，文件不带
 * - 工作区根目录表示为空串 ""
 */

/** 取父目录路径（保留结尾 "/"，根目录返回 ""）。 */
export function parentDirOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  if (slash < 0) return "";
  return `${trimmed.slice(0, slash)}/`;
}

/** 取路径最后一段（名称）。 */
export function baseNameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const slash = trimmed.lastIndexOf("/");
  return slash < 0 ? trimmed : trimmed.slice(slash + 1);
}

/** 把父目录与单段名称拼成完整路径。 */
export function joinWorkspacePath(
  parent: string,
  name: string,
  kind: "file" | "dir",
): string {
  const prefix = parent === "" || parent.endsWith("/") ? parent : `${parent}/`;
  return `${prefix}${name}${kind === "dir" ? "/" : ""}`;
}

/** 目录行的展开键；store 用它记录展开状态。 */
export function directoryKeyOf(root: string, dirPath: string): string {
  return `${root}:${dirPath}`;
}

/**
 * 操作成功后要打开的路径；目录没有"打开"的概念，返回 undefined。
 * 单独抽出来是为了让"新建 -> 是否跳转"这个判断可测。
 */
export function openTargetAfterCreate(
  createdPath: string,
  kind: "file" | "dir",
): string | undefined {
  return kind === "file" ? createdPath : undefined;
}

/**
 * 新建 / 删除的实际执行体。
 *
 * 只做三件事：调 IPC、把失败写回 store、成功后刷新树。
 * 界面状态（draft / pendingDelete）由调用方决定何时清理，便于失败时保留输入。
 */
export function useFileOperations(root: string) {
  const refreshTree = useFilesStore((state) => state.refreshTree);
  const setTreeError = useFilesStore((state) => state.setTreeError);
  const expandDirectory = useFilesStore((state) => state.expandDirectory);

  const createEntry = useCallback(
    async (parent: string, name: string, kind: "file" | "dir") => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      const result = await window.piLing.createEntry(
        root,
        parent,
        trimmed,
        kind,
      );
      if (!result.ok) {
        setTreeError(result.message);
        // 返回 false 让调用方保留输入框，用户可以直接改名重试
        return false;
      }
      setTreeError(null);
      // 先展开父目录，再刷新树 —— 否则新建的条目藏在折叠的目录里看不到
      expandDirectory(directoryKeyOf(root, parent));
      refreshTree();
      const created = joinWorkspacePath(parent, trimmed, kind);
      const openTarget = openTargetAfterCreate(created, kind);
      if (openTarget) {
        useFilesStore.getState().openFile(openTarget);
      }
      return true;
    },
    [expandDirectory, refreshTree, root, setTreeError],
  );

  const deleteEntry = useCallback(
    async (path: string) => {
      const result = await window.piLing.deleteEntry(root, path);
      if (!result.ok) {
        setTreeError(result.message);
        return false;
      }
      setTreeError(null);
      refreshTree();
      return true;
    },
    [refreshTree, root, setTreeError],
  );

  return { createEntry, deleteEntry };
}
