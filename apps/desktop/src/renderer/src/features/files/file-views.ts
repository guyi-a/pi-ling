import type { WorkspaceFileContent, WorkspaceFileKind } from "@pi-ling/contracts";

/**
 * Files 面板的两种呈现方式，对齐 Cursor 右侧面板的 Preview / Source：
 * - `preview`：渲染后的效果（Markdown 排版、CSV 表格）
 * - `source`：可编辑的源码（CodeMirror）
 */
export type FileViewMode = "preview" | "source";

export interface FileViewInput {
  kind: WorkspaceFileKind | WorkspaceFileContent["kind"];
  path: string;
}

function isTabular(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".csv") || lower.endsWith(".tsv");
}

/**
 * 该文件支持哪些视图。返回空数组表示「不显示切换按钮」，直接用现有渲染器。
 *
 * - Markdown：Preview（渲染）+ Source（编辑）
 * - CSV / TSV：Preview（表格）+ Source（编辑）
 * - 其他文本：仅 Source（直接进编辑器）
 * - 图片 / PDF / DOCX / PPTX / 音视频 / 二进制 / 不支持：无切换，沿用原渲染器
 */
export function resolveFileViews(input: FileViewInput): FileViewMode[] {
  switch (input.kind) {
    case "markdown":
      return ["preview", "source"];
    case "text":
      return isTabular(input.path) ? ["preview", "source"] : ["source"];
    default:
      return [];
  }
}

/** 该类型是否有可编辑的源码视图。 */
export function hasSourceView(views: readonly FileViewMode[]): boolean {
  return views.includes("source");
}

/**
 * 在可用视图里挑出实际要显示的。
 *
 * `preferred` 是用户上次的选择（全局记住）。若该类型不支持这个视图，
 * 回退到第一个可用视图；没有任何视图时返回 undefined。
 */
export function pickFileView(
  views: readonly FileViewMode[],
  preferred: FileViewMode | null | undefined,
): FileViewMode | undefined {
  if (views.length === 0) return undefined;
  if (preferred && views.includes(preferred)) return preferred;
  return views[0];
}
