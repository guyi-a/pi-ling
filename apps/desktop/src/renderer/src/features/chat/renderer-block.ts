/**
 * 对话内联渲染：把 ` ```html type="renderer" ` 围栏渲染成图，而不是展示成代码。
 *
 * 这个模块**刻意不 import dompurify**，原因有二：
 * 1. 本文件要能在 node 测试环境里加载（pi-ling 的 vitest 无 DOM，DOMPurify 需要 window）
 * 2. sanitize 函数接收 purifier 作为参数，测试可以传假实现，
 *    从而断言「消毒配置确实被原样传下去了」—— 这是本项目最重要的一条安全契约
 */

/** DOMPurify 的最小结构约定（用注入而非直接依赖，见文件头注释）。 */
export interface HtmlPurifier {
  sanitize(html: string, config?: Record<string, unknown>): string;
}

/**
 * 消毒配置 —— **本功能的安全边界**。
 *
 * 为什么需要它：渲染的内容是模型生成的 HTML。若不消毒就写进 DOM，其中的
 * `<script>` 会在**渲染进程**里执行，而渲染进程持有 `window.piLing`
 * （能写文件、跑命令、删文件）。那等于给模型开了一条 RCE。
 *
 * 注意 Shadow DOM **不提供**脚本隔离（它只隔离 CSS），所以脚本隔离的
 * 责任完全落在这里 —— 这也是选用 DOMPurify 这种专职库而不是手写白名单的原因。
 *
 * 配置单独导出（与执行分离），便于契约测试逐条钉住。
 */
export const RENDERER_SANITIZE_CONFIG: Record<string, unknown> = {
  // 允许 HTML 与 SVG（含 SVG 滤镜，卡片常用到渐变 / 阴影）
  USE_PROFILES: { html: true, svg: true, svgFilters: true },

  // 显式禁用可执行 / 可外联 / 可劫持导航的标签。
  // 其中 foreignObject 是 SVG 里嵌入 HTML 的通道，必须挡掉，
  // 否则它会绕过「只允许 SVG」的意图。
  FORBID_TAGS: [
    "script",
    "foreignObject",
    "iframe",
    "frame",
    "frameset",
    "object",
    "embed",
    "applet",
    "form",
    "input",
    "textarea",
    "select",
    "option",
    "button",
    "link",
    "meta",
    "base",
    "noscript",
    "template",
  ],

  // 事件处理器属性（onclick / onerror / onload ...）。
  // DOMPurify 默认就会清理，这里显式列出以表明意图，并防止
  // 后续有人误加 ALLOW_ATTR 时把口子打开。
  FORBID_ATTR: [
    "srcdoc",
    "formaction",
    "ping",
    "onerror",
    "onload",
    "onclick",
    "ondblclick",
    "onmousedown",
    "onmouseup",
    "onmouseover",
    "onmouseout",
    "onmousemove",
    "onfocus",
    "onblur",
    "onchange",
    "onsubmit",
    "onkeydown",
    "onkeyup",
    "onkeypress",
    "onanimationstart",
    "onanimationend",
    "ontransitionend",
  ],

  /*
   * 注意：**不要**覆盖 `ALLOWED_URI_REGEXP`。
   *
   * 踩过的坑：本意是「只允许内联引用」，于是写了个 `/^(?:#|data:)/` 传进去，
   * 结果整个 SVG 被剥成了光壳 —— `viewBox` / `x` / `y` / `width` / `height` /
   * `fill` / `stroke` / `font-size` 全部消失，只剩 `id` 和 `role`。
   *
   * 原因：DOMPurify 用 `IS_ALLOWED_URI = /^(?:...|[a-z+.\-]+(?:[^a-z+.\-:]|$))/`
   * 判断「这个属性名像不像 URI 属性」，而**几乎任何纯字母属性名都能匹配上**
   * （一路吃到 `$`）。于是每个属性值都要过 ALLOWED_URI_REGEXP，
   * 非 URI 的值（`150`、`var(--x)`、`middle`）全被判为非法。
   *
   * 正确做法是保留 DOMPurify 的默认正则（它会挡掉 `javascript:` 这类协议），
   * 再用 `uponSanitizeAttribute` 钩子按**属性名**精确处理外部 URI —— 见
   * `shouldDropExternalUri`。
   */
  ALLOW_UNKNOWN_PROTOCOLS: false,
  ALLOW_DATA_ATTR: false,

  // 保留注释没必要，且会增大体积
  ALLOW_ARIA_ATTR: true,
};

/**
 * 可能携带 URI、从而可能发起网络请求的属性名（小写）。
 *
 * 只列真正会加载资源的：`href` / `src` / `xlink:href` 等。
 * `fill` / `stroke` / `viewBox` 这类**不在此列** —— 它们虽然也"像" URI 属性，
 * 但取值是颜色或几何数据，不该按 URI 处理（这正是上面那个坑的教训）。
 */
export const URI_ATTRIBUTES = new Set([
  "href",
  "xlink:href",
  "src",
  "srcset",
  "poster",
  "data",
  "action",
  "formaction",
  "cite",
  "background",
  "longdesc",
  "ping",
  "manifest",
  "usemap",
  "codebase",
]);

/**
 * 只放行不产生网络请求的内联引用：`#锚点` 与 `data:image/*`。
 *
 * 比计划里写的「`#` / `data:`」略窄：排除掉 `data:text/html` —— 它虽然不联网，
 * 但在链接导航场景是个脚本执行面。内联图片才是这里真正要支持的能力。
 */
export function isInlineUri(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^(?:#|data:image\/)/i.test(trimmed);
}

/** 在 CSS 文本里找出所有 `url(...)` / `@import` 的引用目标。 */
function cssReferences(css: string): string[] {
  const references: string[] = [];
  // @import 无法指向内联引用（data: CSS 不值得支持），一律视为外部
  if (/@import\b/i.test(css)) references.push("@import");
  const pattern = /url\(\s*(['"]?)([^'")]*)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) {
    references.push(match[2] ?? "");
  }
  return references;
}

/** 这段 CSS 是否引用了外部资源（会发起网络请求）。 */
export function cssReferencesExternalResource(css: string): boolean {
  return cssReferences(css).some((reference) => !isInlineUri(reference));
}

/**
 * 是否该丢弃这个属性 —— 安全与「离线可用」的**唯一判定点**。
 *
 * 用作 `uponSanitizeAttribute` 钩子的判据，同时是纯函数，可以直接单测。
 */
export function shouldDropExternalUri(
  attrName: string,
  attrValue: string,
): boolean {
  const name = attrName.toLowerCase();
  if (URI_ATTRIBUTES.has(name)) return !isInlineUri(attrValue);
  // style 属性里的 `background: url(https://...)` 同样会发请求，
  // 而 DOMPurify 不解析 CSS —— 需要自己挡。
  if (name === "style") return cssReferencesExternalResource(attrValue);
  return false;
}


/**
 * 判断一个代码围栏的 meta 是否标记了「请渲染我」。
 *
 * 实测 Streamdown 会把围栏信息串原样传下来：
 *   ```html type="renderer"   →  meta = 'type="renderer"'
 *   ```svg type='renderer'    →  meta = "type='renderer'"
 *   ```html renderer          →  meta = 'renderer'
 *   ```html                   →  meta = undefined
 * 所以三种写法都要认，避免模型换个引号就失效。
 */
export function parseRendererMeta(meta: string | undefined): boolean {
  if (!meta) return false;
  const normalized = meta.trim();
  if (!normalized) return false;
  // type="renderer" / type='renderer' / type=renderer / 裸 renderer
  return /(?:^|\s)type\s*=\s*["']?renderer["']?(?:\s|$)/i.test(normalized) ||
    /(?:^|\s)renderer(?:\s|$)/i.test(normalized);
}

/** 消毒结果。失败必须显式返回，不能静默留空白。 */
export type SanitizeResult =
  | { ok: true; html: string }
  | { ok: false; message: string };

/**
 * 渲染块的哨兵语言名。
 *
 * 为什么用哨兵语言而不是直接注册 `html` / `svg` 渲染器：
 * 注册某个语言会命中**所有**该语言的围栏，包括用户代码里普通的
 * `<div>...</div>` 代码示例。那样就得在自己的渲染器里重新实现一遍
 * Streamdown 的默认代码块（容器、复制按钮、高亮），任何细节没对齐都是回归。
 *
 * 改成「预处理阶段把 renderer 围栏改写成这个语言」，普通代码块就完全不经过
 * 我们的组件 —— 零回归风险。这个手法与既有的 `tagPlainCodeFenceOpenings`
 * （给无标签围栏补语言）是同一套思路。
 */
export const RENDERER_LANGUAGE = "pi-renderer";

const FENCE_PATTERN = /^(`{3,})([^\n`]*?)\s*$/;

/**
 * 把带 `type="renderer"` 的围栏改写成哨兵语言，交给 InlineRendererView 渲染。
 *
 * 只改写开围栏，且复用与 `tagPlainCodeFenceOpenings` 相同的围栏配对逻辑，
 * 避免把围栏内部的 ``` 误判成新的围栏。
 */
export function tagRendererCodeFences(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let openTicks = 0;

  for (const line of lines) {
    const match = FENCE_PATTERN.exec(line);
    if (!match) {
      output.push(line);
      continue;
    }
    const ticks = match[1]!;
    const info = (match[2] ?? "").trim();

    // 闭围栏：反引号数量不少于开围栏，原样保留
    if (openTicks > 0) {
      if (ticks.length >= openTicks) openTicks = 0;
      output.push(line);
      continue;
    }

    openTicks = ticks.length;
    // info 形如 `html type="renderer"` / `svg type='renderer'` / `html renderer`
    if (info && parseRendererMeta(info)) {
      output.push(`${ticks}${RENDERER_LANGUAGE}`);
      continue;
    }
    output.push(line);
  }

  return output.join("\n");
}

/**
 * 消毒模型生成的 HTML。
 *
 * 失败时**不抛异常**，而是返回 `{ ok: false }` —— 调用方据此降级为代码块显示
 * 原始内容。对应 skill 里的「失败可降级：任何失败都不能留下空白」。
 */
export function sanitizeRendererHtml(
  html: string,
  purifier: HtmlPurifier,
): SanitizeResult {
  if (!html.trim()) return { ok: false, message: "内容为空" };
  try {
    const cleaned = purifier.sanitize(html, RENDERER_SANITIZE_CONFIG);
    if (!cleaned.trim()) {
      return { ok: false, message: "内容在消毒后被清空" };
    }
    return { ok: true, html: cleaned };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
