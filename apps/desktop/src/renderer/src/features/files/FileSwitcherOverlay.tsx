import { useEffect, useRef, type RefObject } from "react";

import { useWorkspaceTree } from "./WorkspaceTree";
import { useFilesStore } from "./store";
import { WorkspaceTreeList } from "./workspace-tree";

export function FileSwitcherOverlay(props: {
  root: string;
  anchorRef: RefObject<HTMLElement | null>;
}) {
  const previewPath = useFilesStore((state) => state.previewPath);
  const closeSwitcher = useFilesStore((state) => state.closeSwitcher);
  const { roots, rootName, truncated, error, loading } = useWorkspaceTree(
    props.root,
  );
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (props.anchorRef.current?.contains(target)) return;
      closeSwitcher();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSwitcher();
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [closeSwitcher, props.anchorRef]);

  return (
    <div
      ref={panelRef}
      className="files-switcher"
      role="tree"
      aria-label="切换预览文件"
    >
      <div className="files-switcher-head">
        <span className="files-switcher-root" title={rootName}>
          {rootName || props.root}
        </span>
      </div>
      <div className="files-switcher-tree">
        {loading ? (
          <div className="files-switcher-empty">Loading…</div>
        ) : error ? (
          <div className="files-switcher-empty">加载失败：{error}</div>
        ) : roots.length === 0 ? (
          <div className="files-switcher-empty">空目录。</div>
        ) : (
          <WorkspaceTreeList
            root={props.root}
            nodes={roots}
            selectedPath={previewPath}
            compact
          />
        )}
      </div>
      {truncated ? (
        <div className="files-switcher-empty">目录项过多，已截断显示。</div>
      ) : null}
    </div>
  );
}
