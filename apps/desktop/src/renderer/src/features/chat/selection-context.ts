/**
 * 「把选中内容加入对话」的纯逻辑：引用块的格式化、长度控制、浮动按钮的定位。
 *
 * 这个模块刻意不做 DOM 查询 —— 选区读取与事件绑定在 SelectionToolbar 里，
 * 这里只处理可测的纯计算。定位逻辑尤其值得抽出来：跨行选区、贴边翻转这些
 * 分支靠手点很难覆盖全。
 */

/** 引用来源。`kind` 用于给不同面板的引用做区分（也便于将来接入文件行号）。 */
export interface ContextSource {
  kind: "file" | "chat" | "terminal";
  /** 已格式化好的来源标签，例如 `docs/py/lru.py:12-20` / `对话记录` / `终端输出`。 */
  label: string;
}

/** 一段被引用进对话的上下文。 */
export interface ContextSnippet {
  id: string;
  /** 引用正文；发送时原样进入用户消息。 */
  text: string;
  source?: ContextSource;
}

/**
 * 标记占位符。
 *
 * 一个不可见的私用区字符，在遍历阶段代替真实的序号写入正文。它的关键作用是
 * 充当**非空白锚点**：后续做空白规整时，标记前面的空白会被一并压掉，标记自然
 * 落到行首，不需要做任何偏移映射 —— 偏移映射在空白被改写后必然失效。
 */
export const MARKER_SENTINEL = "\uE000";

/** 引用正文的片段。`kind` 决定空白如何处理。 */
export interface ExcerptSegment {
  text: string;
  /**
   * - `list`：列表内的文本。Streamdown 的 `ul` 会输出 `<li>\n<p>…</p>\n</li>`，
   *   原样拼接会得到一串空行。这里做空白规整，让引用可读。
   * - `pre`：代码块，**逐字符原样保留**（缩进是代码语义的一部分）。
   * - `text`：普通正文，保持原样。
   */
  kind: "text" | "list" | "pre";
}

/** 把一个片段的空白规整到「每个换行只出现一次」。 */
function normalizeListText(value: string): string {
  return value
    .replace(/[^\S\n]*\n[^\S\n]*/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/[ \t]{2,}/g, " ");
}

/**
 * 组装引用正文。
 *
 * 先**合并相邻同类片段**再规整 —— 空白串常常横跨多个文本节点
 * （Streamdown 会连续输出多个 `"\n"` 节点），逐个片段规整会漏掉它们。
 * 然后裁掉首尾空白，最后把哨兵替换成真实标记。
 */
export function assembleExcerpt(
  segments: readonly ExcerptSegment[],
  markers: readonly string[],
): string {
  let out = "";
  let buffer = "";
  let bufferKind: ExcerptSegment["kind"] | null = null;

  const flush = () => {
    if (!buffer) return;
    out += bufferKind === "list" ? normalizeListText(buffer) : buffer;
    buffer = "";
  };

  for (const segment of segments) {
    if (!segment.text) continue;
    if (bufferKind !== null && segment.kind !== bufferKind) flush();
    bufferKind = segment.kind;
    buffer += segment.text;
  }
  flush();

  let text = out.trim();

  // 标记与内容之间补一个空格（`1.` → `1. 内容`）；标记文本自带缩进时同样适用
  let index = 0;
  text = text.replace(new RegExp(MARKER_SENTINEL, "g"), () => {
    const marker = markers[index++] ?? "";
    return marker ? `${marker} ` : "";
  });
  return text;
}

/** 供测试：`^` 表示这里的空白会被规整。 */
export function excerptWhitespaceProfile(value: string): string {
  return value.replace(/\n/g, "\\n");
}

/**
 * 单段引用的正文上限。
 *
 * 选中的可能是一整段回答，直接塞进去会吃掉大量上下文窗口。超出部分截断并
 * 显式标注，让模型知道自己看到的不全 —— 比静默截断安全。
 */
export const MAX_SNIPPET_CHARS = 8000;

export const CONTEXT_HEADER_PREFIX = "[引用 ";

const CHAT_SOURCE_LABEL = "对话记录";

/** 由文件路径与行号区间生成来源标签，例如 `src/a.ts:12-20`。 */
export function formatFileSource(
  path: string,
  startLine?: number,
  endLine?: number,
): string {
  if (!startLine || startLine < 1) return path;
  // 单行就不写成 `12-12`
  if (!endLine || endLine <= startLine) return `${path}:${startLine}`;
  return `${path}:${startLine}-${endLine}`;
}

export function chatSource(): ContextSource {
  return { kind: "chat", label: CHAT_SOURCE_LABEL };
}

/** 终端输出的引用来源。 */
export function terminalSource(): ContextSource {
  return { kind: "terminal", label: "终端输出" };
}

/**
 * 截断过长的引用正文。
 *
 * `truncated` 为 true 时会在末尾加一行显式说明，而不是默默截掉一半。
 */
export function capSnippetText(
  text: string,
  max = MAX_SNIPPET_CHARS,
): { text: string; truncated: boolean } {
  // 先用字符数做粗筛，避免对超大文本做无意义的逐字扫描
  if (text.length <= max) return { text, truncated: false };
  const kept = text.slice(0, max);
  return {
    text: `${kept}\n…（引用过长，已截断；完整内容请用工具读取）`,
    truncated: true,
  };
}

/** 芯片上的紧凑预览：折叠空白、截断。 */
export function snippetPreview(text: string, max = 48): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max)}…`;
}

/**
 * 把一段引用格式化成消息正文里的块。
 *
 * 用 `[引用 …]` / `[/引用]` 包裹而不是 Markdown 围栏：用户消息在时间线里是
 * **纯文本**渲染（见 UserTurnPrompt），``` 会原样显示成反引号字符，很难看。
 * 方括号提示同时给了模型明确的边界。
 */
export function formatSnippetBlock(snippet: ContextSnippet): string {
  const label = snippet.source?.label ?? CHAT_SOURCE_LABEL;
  return `${CONTEXT_HEADER_PREFIX}${label}]\n${snippet.text}\n[/引用]`;
}

/**
 * 把引用块拼到用户输入前面。
 *
 * 引用在前、用户的话在后：读起来是「这是上下文，接下来是我的要求」，
 * 也和模型处理长上下文的习惯一致。没有引用时原样返回，不做任何包装。
 */
export function composePromptWithContext(
  prompt: string,
  snippets: readonly ContextSnippet[],
): string {
  const trimmed = prompt.trim();
  if (snippets.length === 0) return trimmed;
  const blocks = snippets.map(formatSnippetBlock).join("\n\n");
  if (!trimmed) return blocks;
  return `${blocks}\n\n${trimmed}`;
}

/**
 * 是否应该弹出「加入对话」按钮。
 *
 * 排除输入框内的选区（用户在自己编辑 prompt），以及空选区。
 */
export function shouldOfferAddToChat(input: {
  text: string;
  isCollapsed: boolean;
  isInsideExcluded: boolean;
}): boolean {
  if (input.isCollapsed) return false;
  if (input.isInsideExcluded) return false;
  return input.text.trim().length > 0;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 计算浮动按钮的位置：优先贴在选区上方，上方放不下就翻到下方；
 * 水平方向以选区中心对齐，并夹在视口内。
 *
 * `gap` 是按钮与选区之间的间距。
 */
export function placeToolbar(input: {
  anchor: Rect;
  toolbar: { width: number; height: number };
  viewport: { width: number; height: number };
  gap?: number;
}): { left: number; top: number } {
  const gap = input.gap ?? 8;
  const { anchor, toolbar, viewport } = input;

  const above = anchor.top - toolbar.height - gap;
  const below = anchor.bottom + gap;
  // 上方空间不够就往下方放；都放不下时取上方（至少不会被顶部裁掉）
  const top = above >= gap ? above : below + toolbar.height <= viewport.height ? below : gap;

  const centered = anchor.left + (anchor.right - anchor.left) / 2 - toolbar.width / 2;
  const maxLeft = Math.max(gap, viewport.width - toolbar.width - gap);
  const left = Math.min(Math.max(centered, gap), maxLeft);

  return { left, top };
}
