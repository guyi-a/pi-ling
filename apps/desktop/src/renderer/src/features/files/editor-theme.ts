import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";

/**
 * CodeMirror 的深浅两套主题，供 Files 编辑器与 Changes 的 MergeView 共用。
 *
 * ## 为什么是 VS Code Dark+ / Light+
 *
 * 聊天侧的代码块由 Shiki 渲染，用的是 `dark-plus` / `light-plus`（见
 * `features/chat/Markdown.tsx`）。编辑器这边必须用同一套色板，否则同一个文件
 * 在聊天里引用、在编辑器打开、在 diff 里审阅会长成三个样子。
 *
 * 这两套色值**不是凭记忆写的**，是从实际安装的 shiki 主题里提取的
 * （`@shikijs/themes` 的 `dark-plus.mjs` / `light-plus.mjs` 的 `tokenColors`），
 * 所以编辑器与聊天侧逐 token 一致。要改配色，改下面两处 `palette` 即可。
 *
 * ## 表面交给 CSS
 *
 * 底色、字体、行号、选区一律由 `styles/codemirror.css` 通过
 * `CODE_SURFACE_ATTRIBUTES` 打上的 class 下发 —— CodeMirror 的基础主题与任何
 * 第三方主题都用 `adoptedStyleSheets` 在文档样式表之后注入，写进
 * `EditorView.theme` 会被静默压掉（这个坑踩过一次，契约测试已钉住）。
 * 因此这里**只负责语法配色**，不碰 backgroundColor。
 */

interface CodePalette {
  /** 正文 / 运算符 / 标点 */
  text: string;
  comment: string;
  string: string;
  number: string;
  /** keyword / storage / storage.type / meta / modifier */
  keyword: string;
  /**
   * keyword.control：if / for / while / return / import 等控制流关键字。
   *
   * 注意 dark-plus 里 `keyword.control` 出现了两次（#569cd6 然后 #C586C0），
   * TextMate 的语义是**后者胜出** —— 取「第一条匹配」会拿错颜色。
   */
  controlKeyword: string;
  /** entity.name.function / support.function */
  function: string;
  /** entity.name.type / entity.name.class / support.class / support.type */
  type: string;
  /** variable / property */
  variable: string;
  /** variable.other.constant（全大写的常量名） */
  constant: string;
  /** constant.language：true / false / null / self / this */
  languageConstant: string;
  /** entity.name.tag */
  tag: string;
  /** entity.other.attribute-name */
  attribute: string;
  /** constant.character.escape */
  escape: string;
  /** string.regexp */
  regexp: string;
  invalid: string;
  /** markup.heading */
  heading: string;
}

/** 提取自 shiki `dark-plus`（editor.foreground = #D4D4D4）。 */
const DARK_PLUS: CodePalette = {
  text: "#d4d4d4",
  comment: "#6a9955",
  string: "#ce9178",
  number: "#b5cea8",
  keyword: "#569cd6",
  controlKeyword: "#c586c0",
  function: "#dcdcaa",
  type: "#4ec9b0",
  variable: "#9cdcfe",
  constant: "#4fc1ff",
  languageConstant: "#569cd6",
  tag: "#569cd6",
  attribute: "#9cdcfe",
  escape: "#d7ba7d",
  regexp: "#d16969",
  invalid: "#f44747",
  heading: "#569cd6",
};

/** 提取自 shiki `light-plus`（editor.foreground = #000000）。 */
const LIGHT_PLUS: CodePalette = {
  text: "#000000",
  comment: "#008000",
  string: "#a31515",
  number: "#098658",
  keyword: "#0000ff",
  controlKeyword: "#af00db",
  function: "#795e26",
  type: "#267f99",
  variable: "#001080",
  constant: "#0070c1",
  languageConstant: "#0000ff",
  tag: "#800000",
  attribute: "#e50000",
  escape: "#ee0000",
  regexp: "#811f3f",
  invalid: "#cd3131",
  heading: "#800000",
};

/**
 * 把一套色板套到 Lezer 的 tag 上。
 *
 * 两侧共用同一张映射表，因此深浅两版的**语义对应关系必然一致** ——
 * 想调整某一类 token，改色板里对应的一行即可，不必两处同步。
 */
function highlightStyle(palette: CodePalette): HighlightStyle {
  return HighlightStyle.define([
    // 注释（Dark+ / Light+ 都是绿色）
    {
      tag: [
        tags.comment,
        tags.lineComment,
        tags.blockComment,
        tags.docComment,
      ],
      color: palette.comment,
    },
    // 字符串
    {
      tag: [
        tags.string,
        tags.special(tags.string),
        tags.docString,
        tags.character,
        tags.attributeValue,
        tags.url,
      ],
      color: palette.string,
    },
    // 数字
    { tag: [tags.number, tags.integer, tags.float], color: palette.number },
    // 语言级常量：true / false / null / self / this / 单位
    {
      tag: [tags.bool, tags.null, tags.atom, tags.self, tags.unit],
      color: palette.languageConstant,
    },
    // 关键字
    {
      tag: [
        tags.keyword,
        tags.definitionKeyword,
        tags.operatorKeyword,
        tags.modifier,
        tags.meta,
      ],
      color: palette.keyword,
    },
    // 控制流关键字（if / for / return / import …）—— Dark+ 里是紫红色，
    // 与 storage 类的蓝色是两回事，不能合并
    {
      tag: [tags.controlKeyword, tags.moduleKeyword],
      color: palette.controlKeyword,
    },
    // 运算符与标点
    {
      tag: [tags.operator, tags.punctuation, tags.separator, tags.bracket],
      color: palette.text,
    },
    // 函数名
    {
      tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
      color: palette.function,
    },
    { tag: tags.labelName, color: palette.function },
    // 类型 / 类名 / 命名空间
    {
      tag: [
        tags.typeName,
        tags.className,
        tags.namespace,
        tags.definition(tags.typeName),
      ],
      color: palette.type,
    },
    // 变量与属性
    {
      tag: [
        tags.variableName,
        tags.propertyName,
        tags.special(tags.variableName),
        tags.local(tags.variableName),
        tags.definition(tags.variableName),
      ],
      color: palette.variable,
    },
    // 全大写常量名
    { tag: tags.constant(tags.name), color: palette.constant },
    // HTML/XML 标签与属性
    { tag: tags.tagName, color: palette.tag },
    { tag: tags.attributeName, color: palette.attribute },
    // 转义与正则
    { tag: tags.escape, color: palette.escape },
    { tag: tags.regexp, color: palette.regexp },
    // 无效 / 已删除
    { tag: [tags.invalid, tags.deleted], color: palette.invalid },
    // 已插入：Dark+ 的 markup.inserted 用常量数字色（偏绿的浅色）
    { tag: [tags.inserted, tags.changed], color: palette.number },
    // Markdown
    {
      tag: [
        tags.heading,
        tags.heading1,
        tags.heading2,
        tags.heading3,
        tags.heading4,
        tags.heading5,
        tags.heading6,
      ],
      color: palette.heading,
      fontWeight: "bold",
    },
    { tag: tags.link, color: palette.heading, textDecoration: "underline" },
    { tag: tags.strong, fontWeight: "bold" },
    { tag: tags.emphasis, fontStyle: "italic" },
    { tag: tags.strikethrough, textDecoration: "line-through" },
  ]);
}

/**
 * 给编辑器根节点打一个稳定 class，表面样式全部由 `styles/codemirror.css`
 * 通过它下发。
 *
 * 两个组件（CodeEditor / MergeDiffView）都带上它，样式天然一致。
 */
export const CODE_SURFACE_CLASS = "pi-code-surface";

export const CODE_SURFACE_ATTRIBUTES = EditorView.editorAttributes.of({
  class: CODE_SURFACE_CLASS,
});

/**
 * 基础主题：只声明正文色与明暗标记。
 *
 * `{ dark: true/false }` 不能省 —— CodeMirror 用它决定若干内置默认值，
 * 例如占位符与光标的对比策略。
 */
const DARK_BASE = EditorView.theme(
  { "&": { color: DARK_PLUS.text } },
  { dark: true },
);

const LIGHT_BASE = EditorView.theme(
  { "&": { color: LIGHT_PLUS.text } },
  { dark: false },
);

export const DARK_EDITOR_THEME: Extension = [
  DARK_BASE,
  syntaxHighlighting(highlightStyle(DARK_PLUS)),
  CODE_SURFACE_ATTRIBUTES,
];

export const LIGHT_EDITOR_THEME: Extension = [
  LIGHT_BASE,
  syntaxHighlighting(highlightStyle(LIGHT_PLUS)),
  CODE_SURFACE_ATTRIBUTES,
];

/** 当前应用是否为深色（跟随 `html[data-theme]`）。 */
export function readThemeDark(): boolean {
  return document.documentElement.dataset.theme !== "light";
}

export function currentEditorTheme(): Extension {
  return readThemeDark() ? DARK_EDITOR_THEME : LIGHT_EDITOR_THEME;
}

/**
 * 监听 `html[data-theme]` 变化，回调里重新配置主题。
 * 编辑器与 MergeView 都需要各自 dispatch，因此只提供监听、不代为 dispatch。
 */
export function observeThemeChange(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

/*
 * 开发期的 HMR 兜底：改本文件后强制整页刷新。
 *
 * 主题是模块级常量，而 CodeEditor 的挂载 effect 依赖是 [path, readOnly] ——
 * 所以改了这里不会重跑 effect，已创建的 EditorView 会永久持有**挂载那一刻**的
 * 主题扩展。React Fast Refresh 只重渲染组件、不重建 EditorView，于是配色永远
 * 停在旧值，表现为「改了没生效」甚至「代码没高亮」，很容易被误判成 bug。
 *
 * `invalidate()` 表示本模块不适合局部热更新，让 Vite 向上传播成整页刷新。
 * 仅开发期生效，不影响生产构建。
 */
if (import.meta.hot) {
  import.meta.hot.invalidate();
}
