import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 代码着色的**一致性契约**。
 *
 * 现在有两条渲染路径，它们必须给出逐 token 相同的配色：
 *
 * 1. 聊天里的代码块 —— Streamdown + `@streamdown/code` 插件（Shiki 主题）
 * 2. Files 编辑器与 Changes 的 MergeView —— CodeMirror 6
 *
 * 统一到 VS Code 的 `dark-plus` / `light-plus`（与 Cursor 一致）。
 * CodeMirror 侧的色值是从这两个 shiki 主题里**提取**的，不是另抄一份，
 * 下面用断言把「同源」这件事钉住。
 *
 * 另外两条踩过的坑：
 * - 聊天侧主题**只能在插件上配置**：`plugin.getThemes() ?? props.shikiTheme`，
 *   插件的值会覆盖 prop，传 `shikiTheme` 会被静默忽略。
 * - CodeMirror 的表面样式不能写进 `EditorView.theme`（见对应断言）。
 */
function readSource(relativePath: string): string {
  return readFileSync(
    fileURLToPath(new URL(relativePath, import.meta.url)),
    "utf8",
  );
}

/**
 * 剥掉注释再断言。否则「不要出现 X」这类负向断言会被解释性注释误伤 ——
 * 比如 editor-theme.ts 里正文明说「不要 backgroundColor」，注释里就带着这个词。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

const MARKDOWN_TSX = readSource("./Markdown.tsx");
const EDITOR_THEME_TS = readSource("../files/editor-theme.ts");
const CODE_EDITOR_TSX = readSource("../files/CodeEditor.tsx");
const MERGE_DIFF_VIEW_TSX = readSource("../diff/MergeDiffView.tsx");
const CODEMIRROR_CSS = readSource("../../styles/codemirror.css");
const TOKENS_CSS = readSource("../../styles/tokens.css");
const CHAT_CSS = readSource("../../styles/chat.css");
const CHANGES_CSS = readSource("../../styles/changes.css");
const FILES_CSS = readSource("../../styles/files.css");
const TOOL_CARDS_CSS = readSource("../../styles/tool-cards.css");
const TIMELINE_CSS = readSource("../../styles/timeline.css");

const DARK_THEME = "dark-plus";
const LIGHT_THEME = "light-plus";

describe("code highlighting theme contract", () => {
  it("configures both shiki themes on the streamdown code plugin", () => {
    expect(MARKDOWN_TSX).toMatch(/createCodePlugin\(\{/);
    expect(MARKDOWN_TSX).toContain(LIGHT_THEME);
    expect(MARKDOWN_TSX).toContain(DARK_THEME);
  });

  it("does not rely on the shikiTheme prop, which the plugin overrides", () => {
    expect(MARKDOWN_TSX).not.toMatch(/shikiTheme=\{/);
  });

  it("defines one shared dark and light palette for CodeMirror", () => {
    expect(EDITOR_THEME_TS).toContain("DARK_EDITOR_THEME");
    expect(EDITOR_THEME_TS).toContain("LIGHT_EDITOR_THEME");
    expect(EDITOR_THEME_TS).toContain("DARK_PLUS");
    expect(EDITOR_THEME_TS).toContain("LIGHT_PLUS");
  });

  it("keeps the CodeMirror palette in sync with the shiki themes", () => {
    // 这些色值是从 dark-plus.mjs 的 tokenColors 里提取的。若哪天有人手改了
    // 编辑器配色却没同步聊天侧（或反之），这里的断言会先炸。
    for (const [token, color] of [
      ["keyword", "#569cd6"],
      ["controlKeyword", "#c586c0"],
      ["function", "#dcdcaa"],
      ["type", "#4ec9b0"],
      ["variable", "#9cdcfe"],
      ["number", "#b5cea8"],
      ["string", "#ce9178"],
    ] as const) {
      expect(EDITOR_THEME_TS, `dark-plus ${token}`).toMatch(
        new RegExp(`${token}:\\s*"${color}"`),
      );
    }
    for (const [token, color] of [
      ["keyword", "#0000ff"],
      ["controlKeyword", "#af00db"],
      ["function", "#795e26"],
      ["type", "#267f99"],
      ["variable", "#001080"],
      ["number", "#098658"],
      ["string", "#a31515"],
    ] as const) {
      expect(EDITOR_THEME_TS, `light-plus ${token}`).toMatch(
        new RegExp(`${token}:\\s*"${color}"`),
      );
    }
  });

  it("does not collapse control keywords into the keyword color", () => {
    // 踩过的坑：dark-plus 里 `keyword.control` 有两条规则（#569cd6 然后
    // #C586C0），TextMate 语义是**后者胜出**。取「第一条匹配」会得到蓝色，
    // 于是编辑器里 if / return / import 与 class / def 同色，而聊天侧（Shiki）
    // 是紫红 —— 两个解析器长得不一样。这条断言钉住两者的区分。
    expect(EDITOR_THEME_TS).toMatch(/tags\.controlKeyword/);
    expect(EDITOR_THEME_TS).toMatch(/tags\.moduleKeyword/);
    // 且不能出现在 keyword 那一组里
    const keywordGroup = EDITOR_THEME_TS.match(
      /\/\/ 关键字[\s\S]*?\n    \},/,
    )?.[0] ?? "";
    expect(keywordGroup).not.toContain("tags.controlKeyword");
    expect(keywordGroup).not.toContain("tags.moduleKeyword");
  });

  it("uses the Dark+ green for comments in both themes", () => {
    // 这是刻意的决定（对齐 Cursor），而绿色在本产品里是「成功/通过」语义，
    // 容易在后续「优化配色」时被人顺手改掉，所以钉住。
    expect(EDITOR_THEME_TS).toMatch(/comment:\s*"#6a9955"/);
    expect(EDITOR_THEME_TS).toMatch(/comment:\s*"#008000"/);
  });

  it("makes every CodeMirror consumer use the shared theme, not its own", () => {
    for (const [name, source] of [
      ["CodeEditor.tsx", CODE_EDITOR_TSX],
      ["MergeDiffView.tsx", MERGE_DIFF_VIEW_TSX],
    ] as const) {
      expect(source, name).toContain("currentEditorTheme");
      // 不允许再各自引入第三方主题，否则迟早会漂移
      expect(source, name).not.toContain("@codemirror/theme-one-dark");
    }
  });

  it("follows the app theme instead of being pinned to one", () => {
    expect(EDITOR_THEME_TS).toContain("data-theme");
    expect(EDITOR_THEME_TS).toMatch(/MutationObserver/);
    expect(CODE_EDITOR_TSX).toContain("observeThemeChange");
    expect(MERGE_DIFF_VIEW_TSX).toContain("observeThemeChange");
  });

  it("keeps the diff view read-only", () => {
    expect(MERGE_DIFF_VIEW_TSX).toContain("EditorState.readOnly.of(true)");
    expect(MERGE_DIFF_VIEW_TSX).toContain("EditorView.editable.of(false)");
    expect(MERGE_DIFF_VIEW_TSX).toContain("mergeControls: false");
  });

  it("drives the editor surface from CSS, not from EditorView.theme", () => {
    // 踩过的坑：表面样式写进 EditorView.theme 会被静默压掉。CM 的基础主题与
    // 第三方主题都用 adoptedStyleSheets 在文档样式表之后注入，同优先级时后者
    // 胜出，导致底色、字体、行号色全部失效。
    expect(EDITOR_THEME_TS).toContain("CODE_SURFACE_CLASS");
    expect(EDITOR_THEME_TS).toContain("editorAttributes");
    // 表面样式必须完全交给 CSS：theme 里不允许再出现 backgroundColor
    expect(stripComments(EDITOR_THEME_TS)).not.toMatch(/backgroundColor/);

    expect(CODEMIRROR_CSS).toContain(".cm-editor.pi-code-surface");
    // 子元素必须叠到 0,3,0 才能压过 CM 的 `.ͼX .cm-gutters`
    expect(CODEMIRROR_CSS).toContain(
      ".cm-editor.pi-code-surface .cm-gutters",
    );
    expect(CODEMIRROR_CSS).toContain(
      ".cm-editor.pi-code-surface .cm-scroller",
    );
  });

  it("keeps chat code blocks at the same size as body text", () => {
    // 曾经的坑：正文 14px 而代码块 13px，模型贴的代码比正文小一档、明显发虚。
    expect(CHAT_CSS).toMatch(/\.markdown pre code \{[^}]*font-size:\s*14px/);
    expect(CHAT_CSS).toMatch(/\.markdown \{[^}]*font-size:\s*14px/);
    expect(CHAT_CSS).toMatch(/\.markdown pre code \{[^}]*line-height:\s*1\.6/);
  });

  it("does not use fractional font sizes for code", () => {
    // 分数字号（如 0.92em 在 14px 下 = 12.88px）会让字形对不齐像素网格。
    const inlineCodeBlock = CHAT_CSS.match(/\.markdown code \{[^}]*\}/)?.[0] ?? "";
    expect(inlineCodeBlock).not.toMatch(/font-size:\s*0\.92em/);
    expect(FILES_CSS).not.toMatch(/font-size:\s*12\.5px/);
  });

  it("uses the dedicated --code-bg token for every code surface", () => {
    // 踩过的坑：聊天代码块曾用 --surface-2（菜单/按钮的「抬起表面」语义），
    // 比内容区底色亮 16 级，整块明显发灰，且与工具输出/时间线不一致。
    expect(CHAT_CSS).toMatch(
      /\.markdown pre \{[^}]*background:\s*var\(--code-bg\)/,
    );
    expect(CHAT_CSS).toMatch(
      /\.markdown-code-block,[^}]*background:\s*var\(--code-bg\)/,
    );
    expect(TOOL_CARDS_CSS).toMatch(/background:\s*var\(--code-bg\)/);
    expect(TIMELINE_CSS).toMatch(/background:\s*var\(--code-bg\)/);

    // 反向断言（先剥注释，否则解释性注释里提到的旧 token 会误伤）
    const codeBlockRule = stripComments(
      CHAT_CSS.match(/\.markdown-code-block,[\s\S]*?\}/)?.[0] ?? "",
    );
    expect(codeBlockRule).not.toContain("--surface-2");
    expect(codeBlockRule).not.toContain("--surface-1");
  });

  it("draws exactly one frame per code block", () => {
    // 踩过的坑：Streamdown 的围栏块 DOM 是三层，而让位规则曾写成
    // `.markdown-code-block pre` —— 该 class 只有纯文本块的自定义组件会加，
    // Streamdown 外层用的是 Tailwind 工具类（项目无 Tailwind，不生成 CSS），
    // 所以规则没命中，内层 pre 保留了边框与圆角 + 重复内边距，成为「框套框」。
    expect(CHAT_CSS).toMatch(
      /\.markdown \[data-streamdown="code-block"\] pre \{[^}]*border:\s*0/,
    );
    expect(CHAT_CSS).toMatch(
      /\.markdown \[data-streamdown="code-block"\] pre \{[^}]*padding:\s*0/,
    );
    expect(CHAT_CSS).toMatch(
      /\.markdown \[data-streamdown="code-block"\] pre \{[^}]*border-radius:\s*0/,
    );
  });

  it("kills ligatures in every CodeMirror surface", () => {
    // 连字会把 != 和 ==、-> 和 => 合成一个字形，而 diff 审阅恰恰靠分辨它们
    expect(CODEMIRROR_CSS).toContain("font-variant-ligatures: none");
    expect(TOKENS_CSS).toContain("--font-mono");
    // 统一到同一个 token，不再散落硬编码字体栈
    for (const [name, source] of [
      ["chat.css", CHAT_CSS],
      ["changes.css", CHANGES_CSS],
      ["files.css", FILES_CSS],
    ] as const) {
      expect(source, name).not.toContain("Cascadia Code");
    }
  });

  it("gives line numbers a readable, symmetric contrast in both themes", () => {
    expect(TOKENS_CSS).toContain("--editor-gutter:");
    expect(CODEMIRROR_CSS).toContain("var(--editor-gutter)");
    const definitions = TOKENS_CSS.match(/--editor-gutter:/g) ?? [];
    expect(definitions).toHaveLength(2);
  });

  it("does not force subpixel text rendering globally", () => {
    expect(TOKENS_CSS).not.toMatch(/text-rendering:\s*optimizeLegibility/);
  });

  it("keeps keywords blue so code does not compete with error styling", () => {
    // 红色在本产品里是「错误」的语义色（失败的工具卡片、报错提示）。
    // Dark+ 的关键字是蓝色，这条约束依然成立 —— 注意红/绿在 Dark+ 里确实存在
    // （invalid / regexp / 浅色字符串），所以只约束最高频的 keyword。
    expect(EDITOR_THEME_TS).toMatch(/keyword:\s*"#569cd6"/);
    for (const [name, source] of [
      ["Markdown.tsx", MARKDOWN_TSX],
      ["editor-theme.ts", EDITOR_THEME_TS],
    ] as const) {
      expect(source, name).not.toContain("github-light");
      expect(source, name).not.toContain("github-dark");
    }
  });

  it("does not paint whole lines in the diff", () => {
    // 踩过的坑：diff 里整行刷绿/红背景观感很重，而 gutter 竖线 + 字符级高亮
    // 已足够区分增删（Cursor 的审阅样式正是如此）。
    // 关键难点：merge 的 baseTheme 用 `.cm-merge-a/.cm-merge-b` 前缀
    // （特异性 0,3,0），写 0,2,0 的 transparent 会被它压掉，整行仍是默认的
    // rgba(.08) tint。必须带上 `.cm-editor` 叠到 0,4,0。
    expect(CHANGES_CSS).toMatch(
      /\.merge-diff-view \.cm-editor\.cm-merge-[ab] \.cm-changedLine/,
    );
    // 整行背景必须是 transparent，而不是 success-tint / danger-tint
    const lineRule = stripComments(
      CHANGES_CSS.match(
        /\.cm-changedLine,[\s\S]*?cm-inlineChangedLine \{[^}]*\}/,
      )?.[0] ?? "",
    );
    expect(lineRule).toContain("background: transparent");
    expect(lineRule).not.toContain("--success-tint");
    expect(lineRule).not.toContain("--danger-tint");
  });

  it("colors the diff gutter by side, not by line tint", () => {
    // 增删的判断依据是 gutter 竖线：a 侧红、b 侧绿。
    // 注意 `.cm-changedLineGutter` 是两侧共用的类名，必须用
    // `.cm-merge-a` / `.cm-merge-b` 上下文区分，否则 a 侧也会变绿。
    expect(CHANGES_CSS).toMatch(
      /\.cm-merge-a \.cm-changedLineGutter[^{]*\{[^}]*var\(--danger\)/,
    );
    expect(CHANGES_CSS).toMatch(
      /\.cm-merge-b \.cm-changedLineGutter[^{]*\{[^}]*var\(--success\)/,
    );
  });
});
