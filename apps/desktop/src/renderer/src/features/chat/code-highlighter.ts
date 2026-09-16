import { createCodePlugin } from "@streamdown/code";

/**
 * 全应用共享的语法高亮插件（Shiki）。
 *
 * **必须只有这一个实例**：`createCodePlugin` 内部会建 Shiki highlighter，
 * 并按需异步加载语言包。多建一个就等于把语言加载与缓存做两遍 —— 包体里已有
 * 上百个语言 chunk，重复实例会让内存和首屏都白付一份。
 *
 * [浅色, 深色]。必须在这里配置，**不能**用 Streamdown 的 `shikiTheme` prop：
 * 内核取值顺序是 `plugin.getThemes() ?? props.shikiTheme`，插件的主题会覆盖
 * prop，传 prop 会被静默忽略。
 *
 * 用 VS Code 的 `light-plus` / `dark-plus`，与 Cursor 一致。
 *
 * 之前用的是 One Dark Pro / One Light，理由是「它的关键字不是红色」——
 * 红色在本产品里是「错误」的语义色（失败的工具卡片、报错提示），代码块里
 * 满屏红字会和它抢注意力。Dark+ 的关键字是蓝色，同样没有这个问题，
 * 因此这个约束依然成立。
 *
 * 与 Files 面板的 CodeMirror 编辑器（features/files/editor-theme.ts）用的是
 * **同一套色值**（那边是从这两个 shiki 主题里提取的），否则同一个文件在聊天里
 * 引用和在编辑器里打开会长得不一样。
 *
 * 这个模块从 Markdown.tsx 抽出来，是为了让「查看源码」也能用**同一份**主题
 * 与**同一个实例**上色（见 SourceView）。
 */
export const code = createCodePlugin({
  themes: ["light-plus", "dark-plus"],
});

/** 一个 token（语法片段）的两种主题颜色。 */
export interface HighlightToken {
  content: string;
  /** 浅色主题的颜色（light-plus）。 */
  light?: string;
  /** 深色主题的颜色（dark-plus）。 */
  dark?: string;
}

/** 一行高亮结果。渲染时每一行是一个块级元素，行内是若干 token。 */
export interface HighlightLine {
  tokens: HighlightToken[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 把 Shiki 的 token 结果转成好渲染的行结构（纯函数，可单测）。
 *
 * 实测的 token 形状是：
 *   { content: "&lt;", offset: 0, htmlStyle: { "--shiki-dark": "#808080", color: "#800000" } }
 * 即 `color` 是浅色（第一个主题）、`--shiki-dark` 是深色（第二个主题）。
 *
 * 这里刻意**不直接生成 HTML 字符串**：字符串需要手工转义，容易漏；
 * 交给 React 渲染则天然安全（React 会转义文本节点）。所以只做数据整形。
 *
 * 对不认识的形状一律返回 null，让调用方降级为纯文本 —— 宁可不上色，
 * 也不能因为上游改了 token 结构就把源码渲染成空白。
 */
export function toHighlightLines(result: unknown): HighlightLine[] | null {
  const record = asRecord(result);
  const lines = record?.tokens;
  if (!Array.isArray(lines)) return null;

  const output: HighlightLine[] = [];
  for (const line of lines) {
    if (!Array.isArray(line)) return null;
    const tokens: HighlightToken[] = [];
    for (const rawToken of line) {
      const token = asRecord(rawToken);
      if (typeof token?.content !== "string") return null;
      const htmlStyle = asRecord(token.htmlStyle);
      const light = htmlStyle?.color;
      const dark = htmlStyle?.["--shiki-dark"];
      tokens.push({
        content: token.content,
        ...(typeof light === "string" ? { light } : {}),
        ...(typeof dark === "string" ? { dark } : {}),
      });
    }
    output.push({ tokens });
  }
  return output;
}

/**
 * 高亮一段源码。
 *
 * Shiki 的语言包是**异步加载**的：首次调用会返回 `null`（并稍后回调），
 * 加载完成后才是同步返回。这里统一包成 Promise，调用方只需要 await。
 */
export function highlightCode(
  source: string,
  language: string,
): Promise<HighlightLine[] | null> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value: unknown) => {
      if (settled) return;
      settled = true;
      resolve(toHighlightLines(value));
    };
    try {
      const immediate = code.highlight(
        {
          code: source,
          language: language as never,
          themes: code.getThemes(),
        },
        (async) => settle(async),
      );
      if (immediate) settle(immediate);
    } catch {
      // 语言不支持等异常一律降级为不高亮，不向上抛
      settle(null);
    }
  });
}
