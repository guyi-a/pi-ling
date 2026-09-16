import { cjk } from "@streamdown/cjk";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { memo, useMemo } from "react";
import type { MouseEvent } from "react";
import { Streamdown } from "streamdown";
// KaTeX 样式与字体（约 1MB），随 renderer 一起打包
import "katex/dist/katex.min.css";

import { InlineRendererView } from "./InlineRendererView";
import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { code } from "./code-highlighter";
import { externalHrefFromClickTarget } from "./external-link";
import { tagPlainCodeFenceOpenings } from "./normalize-plain-code-fences";
import { RENDERER_LANGUAGE, tagRendererCodeFences } from "./renderer-block";

/**
 * 走「纯文本渲染器」的语言。
 *
 * 这些不是真正的编程语言（ASCII 图、树状结构、无标签文本），交给 Shiki
 * 反而会打乱视觉结构，因此用自定义渲染器原样输出。
 * 注意：shell / bash 等**真实语言**不在此列 —— 它们应交给 Shiki 着色。
 */
const PLAIN_CODE_LANGUAGES = [
  "",
  "text",
  "plaintext",
  "txt",
  "console",
  "terminal",
  "ascii",
  "diagram",
  "tree",
  "flow",
] as const;

/**
 * 数学插件开启 `singleDollarTextMath`。
 *
 * Streamdown 默认只认 `$$...$$` 块级公式，行内 `$...$` 不渲染 —— 而模型
 * 写中文回答时几乎总是用单美元。开启后两种都支持。
 */
const math = createMathPlugin({ singleDollarTextMath: true });

/**
 * [浅色, 深色] 的 shiki 主题在共享模块 code-highlighter.ts 里配置
 * （**不能**用 Streamdown 的 `shikiTheme` prop：内核取值顺序是
 * `plugin.getThemes() ?? props.shikiTheme`，插件的主题会覆盖 prop，
 * 传 prop 会被静默忽略）。
 *
 * 抽出去是为了让「查看源码」也能复用**同一个** Shiki 实例与同一份主题 ——
 * 多建一个插件会把语言加载与缓存做两遍。
 */
export const Markdown = memo(function Markdown(props: {
  children: string;
  streaming?: boolean;
}) {
  const plugins = useMemo(
    () => ({
      code,
      math,
      mermaid,
      cjk,
      renderers: [
        {
          // 内联渲染：预处理已把 `type="renderer"` 的围栏改写成这个哨兵语言，
          // 所以这里只会命中真正要渲染成图的块，普通 html / svg 代码块不受影响。
          language: [RENDERER_LANGUAGE],
          component: InlineRendererView,
        },
        {
          language: [...PLAIN_CODE_LANGUAGES],
          component: MarkdownCodeBlock,
        },
      ],
    }),
    [],
  );

  function openLink(event: MouseEvent<HTMLDivElement>) {
    const href = externalHrefFromClickTarget(event.target);
    // 应用内不做页面跳转；可打开的链接交给系统浏览器
    event.preventDefault();
    if (href) void window.piLing.openExternal(href);
  }

  return (
    <div
      className={`markdown ${props.streaming ? "is-streaming" : ""}`}
      onClickCapture={openLink}
    >
      <Streamdown
        lineNumbers={false}
        controls={{ table: false, code: { copy: true, download: false } }}
        translations={{ copyCode: "复制", copied: "已复制" }}
        isAnimating={props.streaming}
        plugins={plugins}
        /* 关掉内置的「Open external link?」确认弹窗：点击直接交给系统浏览器 */
        linkSafety={{ enabled: false }}
      >
        {tagPlainCodeFenceOpenings(tagRendererCodeFences(props.children))}
      </Streamdown>
    </div>
  );
});
