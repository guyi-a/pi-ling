import { useCallback } from "react";

import { useFilesStore } from "./store";
import {
  directoryKeyOf,
  joinWorkspacePath,
  openTargetAfterCreate,
  renamedPathOf,
} from "./workspace-path";

/**
 * Files 面板的新建 / 删除 / 重命名执行体。
 *
 * 只做三件事：调 IPC、把失败写回 store、成功后刷新树与路径重映射。
 * 界面状态（draft / renaming / pendingDelete）由调用方决定何时清理，
 * 便于失败时保留输入让用户改名重试。
 */
/** 把异常转成可展示的消息，避免 IPC 层抛错时界面毫无反馈。 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useFileOperations(root: string) {
  const refreshTree = useFilesStore((state) => state.refreshTree);
  const setTreeError = useFilesStore((state) => state.setTreeError);
  const expandDirectory = useFilesStore((state) => state.expandDirectory);
  const beginRename = useFilesStore((state) => state.beginRename);
  const dirty = useFilesStore((state) => state.dirty);
  const previewPath = useFilesStore((state) => state.previewPath);

  const createEntry = useCallback(
    async (parent: string, name: string, kind: "file" | "dir") => {
      const trimmed = name.trim();
      if (!trimmed) return false;
      let result;
      try {
        result = await window.piLing.createEntry(root, parent, trimmed, kind);
      } catch (error) {
        // IPC 层抛错（例如主进程 handler 未注册）也必须留下可见反馈，
        // 否则输入框会静默消失、用户以为操作成功了
        setTreeError(messageOf(error));
        return false;
      }
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
      let result;
      try {
        result = await window.piLing.deleteEntry(root, path);
      } catch (error) {
        setTreeError(messageOf(error));
        return false;
      }
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

  /**
   * 进入重命名编辑态。
   *
   * 若待改名的就是当前打开且有未保存改动的文件，先拦下 —— 改名会让
   * CodeEditor 因 path 变化而重挂载，未保存的内容会直接丢。与其静默丢失，
   * 不如让用户先保存（Cmd+S）再来。
   */
  const startRename = useCallback(
    (path: string) => {
      const isTargetOpen = previewPath !== null && path === previewPath;
      if (isTargetOpen && dirty) {
        setTreeError("该文件有未保存的改动，请先保存（Ctrl/Cmd+S）再重命名");
        return;
      }
      beginRename(path);
    },
    [beginRename, dirty, previewPath, setTreeError],
  );

  const renameEntry = useCallback(
    async (path: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed) return false;
      let result;
      try {
        result = await window.piLing.renameEntry(root, path, trimmed);
      } catch (error) {
        setTreeError(messageOf(error));
        return false;
      }
      if (!result.ok) {
        setTreeError(result.message);
        return false;
      }
      setTreeError(null);
      // 重映射必须早于刷新：预览面板正指着旧路径，先改掉才不会闪一下"文件不存在"
      const { newPath, kind } = renamedPathOf(path, trimmed);
      useFilesStore.getState().remapPaths(root, path, newPath);
      if (kind === "dir") expandDirectory(directoryKeyOf(root, newPath));
      refreshTree();
      return true;
    },
    [expandDirectory, refreshTree, root, setTreeError],
  );

  return { createEntry, deleteEntry, startRename, renameEntry };
}

// 纯路径工具都在 ./workspace-path，这里 re-export 以保持调用方导入路径单一
export {
  baseNameOf,
  directoryKeyOf,
  joinWorkspacePath,
  openTargetAfterCreate,
  parentDirOf,
  remapExpandedKeys,
  remapPath,
  renameSelectionRange,
  renamedPathOf,
} from "./workspace-path";
