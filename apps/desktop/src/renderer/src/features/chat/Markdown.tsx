import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { createMathPlugin } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { memo, useMemo } from "react";
import type { MouseEvent } from "react";
import { Streamdown } from "streamdown";
// KaTeX 样式与字体（约 1MB），随 renderer 一起打包
import "katex/dist/katex.min.css";

import { MarkdownCodeBlock } from "./MarkdownCodeBlock";
import { externalHrefFromClickTarget } from "./external-link";
import { tagPlainCodeFenceOpenings } from "./normalize-plain-code-fences";

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
 */
const code = createCodePlugin({
  themes: ["light-plus", "dark-plus"],
});

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
        {tagPlainCodeFenceOpenings(props.children)}
      </Streamdown>
    </div>
  );
});
