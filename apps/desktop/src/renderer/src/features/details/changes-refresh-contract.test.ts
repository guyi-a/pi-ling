import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Changes 面板刷新的接线契约。
 *
 * 现象：发消息或 agent 开始输出时，右侧 diff 面板「闪一下」。
 *
 * 根因有三处，都会让面板短暂变空、并把所有文件的 diff 重新取一遍：
 *
 * 1. `refreshChanges`（由 agent 事件防抖触发）里 `setChangesFiles([])` + loading；
 * 2. 取 git 来源的 effect 把 `timeline.items` 放进了依赖 —— 输出期间每个流事件
 *    都会重跑它，于是反复清空重取；
 * 3. `ChangesView` 用裸 `loading` 做遮罩，即使还有内容也会被盖住。
 *
 * 实测（同一组件、只换刷新方式）：
 *   清空方案 t=60ms → sections=0 merge=0 loading=1
 *   保留方案 t=60ms → sections=2 merge=2 loading=0
 *
 * 另外 `FileSection` 曾把 `defaultCollapsed`（由文件数推导）放进重置依赖，
 * 文件数在自动折叠阈值附近波动时会反复清空已加载的 diff。
 */
function readSource(relativePath: string): string {
  // 归一化 CRLF：本仓库源码在 Windows 上是 CRLF，而下面的标记用 \n 书写
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  ).replace(/\r\n/g, "\n");
}

const APP = readSource("../../App.tsx");
const CHANGES_VIEW = readSource("./ChangesView.tsx");

/** 从标记处截到下一个 `}, [` 依赖数组结束，用来断言某个 effect/回调的边界。 */
function blockFrom(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) return "";
  const depsStart = source.indexOf("}, [", start);
  if (depsStart < 0) return source.slice(start);
  const end = source.indexOf("]);", depsStart);
  return source.slice(start, end < 0 ? undefined : end + 3);
}

/** 捕获「某段代码之后第一个 `}, [...]` 依赖数组」的内容。 */
function depsAfter(source: string, marker: RegExp): string | undefined {
  const match = marker.exec(source);
  if (!match) return undefined;
  const rest = source.slice(match.index + match[0].length);
  const deps = /[\s\S]*?\}, \[([^\]]*)\]\);/.exec(rest);
  return deps?.[1]?.trim();
}

describe("changes refresh wiring contract", () => {
  it("does not clear the file list when refreshing in the background", () => {
    const refreshBlock = blockFrom(APP, "const refreshChanges = useCallback(");
    expect(refreshBlock, "refreshChanges 块未找到").not.toBe("");
    // agent 事件会反复触发这里，清空就会闪
    expect(refreshBlock).not.toContain("setChangesFiles([])");
    expect(refreshBlock).not.toContain("setChangesLoading(true)");
    // 但仍要把新数据写回去
    expect(refreshBlock).toContain("setChangesFiles");
  });

  it("refetches git sources only when the source itself changes", () => {
    // 依赖里只能有 changesSource；带上 timeline.items 就会在输出期间反复重跑
    expect(
      depsAfter(APP, /getChanges\(changesSource\)/),
      "取 git 来源的 effect 依赖",
    ).toBe("changesSource");
  });

  it("keeps last-agent-turn syncing tied to the timeline", () => {
    // 这个来源的数据是从 items 推导的，反过来必须跟着 items 变
    const deps = depsAfter(
      APP,
      /if \(changesSource !== "last-agent-turn"\) return;/,
    );
    expect(deps, "last-agent-turn 同步 effect 依赖").toContain("timeline.items");
    expect(deps).toContain("syncLastAgentTurnChanges");
  });

  it("only uses the loading mask when there is nothing to show", () => {
    expect(CHANGES_VIEW).toContain("showLoadingState");
    // 裸 `loading ?` 会把已有内容也盖住
    expect(CHANGES_VIEW).not.toMatch(/\{loading \? \(/);
    expect(CHANGES_VIEW).toMatch(
      /showLoadingState = Boolean\(loading\) && files\.length === 0/,
    );
    expect(CHANGES_VIEW).toContain("{showLoadingState ? (");
  });

  it("does not reset a loaded diff when the auto-collapse threshold flips", () => {
    // 依赖里不能有 defaultCollapsed（它是「文件数 > 6」推导出来的）
    expect(
      depsAfter(CHANGES_VIEW, /setDiff\(undefined\);/),
      "FileSection 重置 effect 依赖",
    ).toBe("file.path");
  });
});
