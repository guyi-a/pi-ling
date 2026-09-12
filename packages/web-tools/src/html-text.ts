/**
 * HTML → 纯文本。
 *
 * 与参考实现（LingCoWork）的差异：**保留文档结构**。
 * 参考实现把所有空白（含换行）压成单个空格 —— 对新闻页够用，但对
 * 文档页会把代码块压成一行，读回来基本不可用。
 *
 * 这里的策略：
 * 1. 先摘出 `<pre>` 代码块并原样保护（保留内部换行）
 * 2. 块级标签转成换行哨兵，其中 `<p>/<div>/<h1..6>` 等分隔为**空行**，
 *    `<li>/<tr>/<br>` 等分隔为**单换行**（列表不会被拆散）
 * 3. 其余标签剔除、实体解码、空白压缩
 * 4. 回填代码块
 */

const COMMENT_RE = /<!--[\s\S]*?-->/g;
const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style>/gi;
const NOSCRIPT_RE = /<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi;
const HEAD_RE = /<head\b[^>]*>[\s\S]*?<\/head>/gi;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const PRE_RE = /<pre\b[^>]*>([\s\S]*?)<\/pre>/gi;
const TAG_RE = /<[^>]+>/g;

/** 段落级分隔：前后留空行。 */
const HARD_BREAK_TAGS =
  "p|div|section|article|header|footer|main|aside|nav|ul|ol|dl|table|thead|tbody|h[1-6]|blockquote|pre|hr|form|figure|figcaption|details|summary|html|body";
/** 行级分隔：只换行，不空行（列表项、表格单元格、换行符）。 */
const SOFT_BREAK_TAGS = "br|li|tr|td|th|dt|dd";

const HARD_BREAK_RE = new RegExp(
  `<\\s*/?\\s*(?:${HARD_BREAK_TAGS})\\b[^>]*>`,
  "gi",
);
const SOFT_BREAK_RE = new RegExp(
  `<\\s*/?\\s*(?:${SOFT_BREAK_TAGS})\\b[^>]*>`,
  "gi",
);

const HARD_BREAK = "\u0002";
const SOFT_BREAK = "\u0001";
const PRE_MARKER_RE = /\u0000PRE:(\d+)\u0000/g;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  times: "×",
  divide: "÷",
  deg: "°",
  euro: "€",
  pound: "£",
  yen: "¥",
  laquo: "«",
  raquo: "»",
  larr: "←",
  rarr: "→",
  check: "✓",
  cross: "✗",
};

const ENTITY_RE = /&(#[xX]?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

export function decodeHtmlEntities(input: string): string {
  return input.replace(ENTITY_RE, (match, body: string) => {
    if (body.startsWith("#")) {
      const isHex = body[1] === "x" || body[1] === "X";
      const digits = body.slice(isHex ? 2 : 1);
      const code = Number.parseInt(digits, isHex ? 16 : 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

function collapseLayout(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

/** 归一化 `<pre>` 内部文本：统一换行、去掉行尾空白与首尾空行。 */
function normalizePreformatted(inner: string): string {
  return decodeHtmlEntities(inner.replace(TAG_RE, ""))
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
}

/** 去掉标签与脚本，返回保留结构的纯文本。 */
export function extractTextFromHtml(html: string): string {
  const stripped = html
    .replace(COMMENT_RE, " ")
    .replace(SCRIPT_RE, " ")
    .replace(STYLE_RE, " ")
    .replace(NOSCRIPT_RE, " ")
    .replace(HEAD_RE, " ");

  // 1) 摘出代码块，避免被空白压缩破坏
  const preBlocks: string[] = [];
  const withPreMarkers = stripped.replace(PRE_RE, (_match, inner: string) => {
    preBlocks.push(normalizePreformatted(inner));
    const index = preBlocks.length - 1;
    return `${HARD_BREAK}\u0000PRE:${index}\u0000${HARD_BREAK}`;
  });

  // 2) 块级 / 行级边界转哨兵
  const withBoundaries = withPreMarkers
    .replace(HARD_BREAK_RE, HARD_BREAK)
    .replace(SOFT_BREAK_RE, SOFT_BREAK);

  // 3) 剔除剩余标签 → 实体解码 → 压缩空白
  const collapsed = decodeHtmlEntities(withBoundaries.replace(TAG_RE, " "))
    .replace(/\s+/g, " ")
    .trim();

  // 4) 哨兵还原成换行：连续哨兵合并为一次分隔（含硬分隔则留空行）
  const laidOut = collapsed
    .replace(/[\u0001\u0002]+/g, (run) =>
      run.includes(HARD_BREAK) ? "\n\n" : "\n",
    )
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // 5) 回填代码块
  return laidOut
    .replace(PRE_MARKER_RE, (_match, index: string) => preBlocks[Number(index)] ?? "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 提取 `<title>`；没有则返回 undefined。 */
export function extractTitleFromHtml(html: string): string | undefined {
  const match = TITLE_RE.exec(html);
  if (!match?.[1]) return undefined;
  const title = collapseLayout(decodeHtmlEntities(match[1]));
  return title || undefined;
}
