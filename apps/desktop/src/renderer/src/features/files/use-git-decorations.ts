import { useEffect, useState } from "react";

import {
  buildGitDecorations,
  EMPTY_GIT_DECORATIONS,
  type GitDecorations,
} from "./git-decorations";
import { useFilesStore } from "./store";

/**
 * 读取当前会话工作区的 git 状态，生成文件树装饰。
 *
 * - 装饰属于「当前会话的工作区」，因此 root 只作为重取依赖，不作为查询参数。
 * - 非 git 仓库或 git 不可用时静默返回空装饰（getChanges 已做降级）。
 * - treeEpoch 变化（run_end / changes / 文件类工具结束）时自动重取。
 */
export function useGitDecorations(root: string): GitDecorations {
  const treeEpoch = useFilesStore((state) => state.treeEpoch);
  const [decorations, setDecorations] = useState<GitDecorations>(
    EMPTY_GIT_DECORATIONS,
  );

  useEffect(() => {
    if (!root.trim()) {
      setDecorations(EMPTY_GIT_DECORATIONS);
      return;
    }
    let cancelled = false;
    void window.piLing
      .getChanges("uncommitted")
      .then((files) => {
        if (!cancelled) setDecorations(buildGitDecorations(files));
      })
      .catch(() => {
        if (!cancelled) setDecorations(EMPTY_GIT_DECORATIONS);
      });
    return () => {
      cancelled = true;
    };
  }, [root, treeEpoch]);

  return decorations;
}
