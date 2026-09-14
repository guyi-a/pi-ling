import type { WorkspaceTreeNode as WorkspaceTreeEntry } from "@pi-ling/contracts";
import { FilePlus, FolderPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { baseNameOf, useFileOperations } from "./file-operations";
import { useGitDecorations } from "./use-git-decorations";
import { buildTree, WorkspaceTreeList } from "./workspace-tree";
import {
  readWorkspaceTreeCacheLatest,
  treeSnapshotSignature,
  writeWorkspaceTreeCache,
} from "./workspace-tree-cache";
import { useFilesStore } from "./store";

type TreeState = {
  entries: WorkspaceTreeEntry[] | null;
  rootName: string;
  truncated: boolean;
  error: string | null;
  signature: string;
};

function emptyTreeState(): TreeState {
  return {
    entries: [],
    rootName: "",
    truncated: false,
    error: null,
    signature: "",
  };
}

function initialTreeState(
  root: string,
  cacheEpoch: number,
): TreeState {
  if (!root.trim()) return emptyTreeState();
  const cached = readWorkspaceTreeCacheLatest(root, cacheEpoch);
  if (!cached) {
    return {
      entries: null,
      rootName: "",
      truncated: false,
      error: null,
      signature: "",
    };
  }
  return {
    entries: cached.entries,
    rootName: cached.rootName,
    truncated: cached.truncated,
    error: null,
    signature: treeSnapshotSignature(cached),
  };
}

export function useWorkspaceTree(root: string) {
  const filesVersion = useFilesStore((state) => state.filesVersion);
  const treeEpoch = useFilesStore((state) => state.treeEpoch);
  const cacheEpoch = filesVersion * 1_000_000 + treeEpoch;
  const [state, setState] = useState(() =>
    initialTreeState(root, cacheEpoch),
  );

  useEffect(() => {
    setState(initialTreeState(root, cacheEpoch));
  }, [root, filesVersion]);

  useEffect(() => {
    if (!root.trim()) {
      setState(emptyTreeState());
      return;
    }

    let cancelled = false;

    void window.piLing
      .workspaceTree(root)
      .then((result) => {
        if (cancelled) return;
        const snapshot = {
          entries: result.entries,
          rootName: result.workspaceRootName,
          truncated: Boolean(result.truncated),
        };
        const signature = treeSnapshotSignature(snapshot);
        writeWorkspaceTreeCache(root, cacheEpoch, snapshot);
        setState((current) => {
          if (current.signature === signature) return current;
          return { ...snapshot, error: null, signature };
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            error: err instanceof Error ? err.message : String(err),
          }));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [root, cacheEpoch]);

  const roots = useMemo(
    () => (state.entries ? buildTree(state.entries) : []),
    [state.entries],
  );

  return {
    roots,
    entries: state.entries ?? [],
    loading: state.entries === null && !state.error,
    rootName: state.rootName,
    truncated: state.truncated,
    error: state.error,
  };
}

/** 顶部工具栏：在根目录新建。 */
function TreeToolbar(props: { root: string }) {
  const beginDraft = useFilesStore((state) => state.beginDraft);
  return (
    <div className="files-tree-actions">
      <button
        type="button"
        className="files-tree-action"
        title="新建文件"
        aria-label="在工作区根目录新建文件"
        onClick={() => beginDraft("", "file")}
      >
        <FilePlus size={13} />
      </button>
      <button
        type="button"
        className="files-tree-action"
        title="新建文件夹"
        aria-label="在工作区根目录新建文件夹"
        onClick={() => beginDraft("", "dir")}
      >
        <FolderPlus size={13} />
      </button>
    </div>
  );
}

/**
 * 删除确认条。
 *
 * 删除不可撤销，所以不做"点了就删"。用顶部提示条而不是模态框：
 * 与「未保存改动」的拦截条保持一致，且不会遮挡文件树。
 */
function DeleteConfirmBar(props: { root: string }) {
  const pendingDelete = useFilesStore((state) => state.pendingDelete);
  const cancelDelete = useFilesStore((state) => state.cancelDelete);
  const { deleteEntry } = useFileOperations(props.root);
  const [busy, setBusy] = useState(false);

  if (!pendingDelete) return null;
  const isDir = pendingDelete.endsWith("/");
  const name = baseNameOf(pendingDelete);

  return (
    <div className="files-op-bar" role="alert">
      <span className="files-op-text" title={pendingDelete}>
        删除{isDir ? "文件夹" : "文件"} <strong>{name}</strong>
        {isDir ? " 及其全部内容" : ""}？
      </span>
      <div className="files-op-actions">
        <button
          type="button"
          className="files-op-danger"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void deleteEntry(pendingDelete).finally(() => {
              setBusy(false);
              cancelDelete();
            });
          }}
        >
          删除
        </button>
        <button type="button" className="files-op-cancel" onClick={cancelDelete}>
          取消
        </button>
      </div>
    </div>
  );
}

function TreeErrorBar() {
  const treeError = useFilesStore((state) => state.treeError);
  const setTreeError = useFilesStore((state) => state.setTreeError);
  if (!treeError) return null;
  return (
    <div className="files-op-bar is-error" role="alert">
      <span className="files-op-text" title={treeError}>
        {treeError}
      </span>
      <div className="files-op-actions">
        <button
          type="button"
          className="files-op-cancel"
          onClick={() => setTreeError(null)}
        >
          关闭
        </button>
      </div>
    </div>
  );
}

export function WorkspaceTree(props: { root: string }) {
  const { roots, loading, rootName, truncated, error } = useWorkspaceTree(
    props.root,
  );
  const decorations = useGitDecorations(props.root);

  if (loading) {
    return <div className="files-tree-message">正在加载…</div>;
  }
  if (error) {
    return <div className="files-tree-message">加载失败：{error}</div>;
  }

  return (
    <div className="files-tree" role="tree" aria-label="Files">
      <div className="files-tree-root">
        <span className="files-tree-root-label" title={rootName}>
          {rootName}
        </span>
        <TreeToolbar root={props.root} />
      </div>
      <DeleteConfirmBar root={props.root} />
      <TreeErrorBar />
      {roots.length === 0 ? (
        <div className="files-tree-message">空目录。</div>
      ) : (
        <WorkspaceTreeList
          root={props.root}
          nodes={roots}
          decorations={decorations}
        />
      )}
      {truncated ? (
        <div className="files-tree-message">目录项过多，已截断显示。</div>
      ) : null}
    </div>
  );
}
