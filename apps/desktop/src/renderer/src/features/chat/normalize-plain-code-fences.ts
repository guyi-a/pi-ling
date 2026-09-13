const CODE_FENCE_PATTERN = /^(`{3,})([^\n`]*?)\s*$/;

/** 图形/表格字符：出现这些说明是 ASCII 图，不该套语言高亮。 */
const DIAGRAM_CHARS = /[┌┐└┘├┤┬┴┼─│╱╲╳↕↔⇅▲▼◀▶→←↑↓]/;

/** 纯函数：根据代码内容猜语言；无法判断时返回 undefined。 */
export function detectFenceLanguage(code: string): string | undefined {
  const trimmed = code.trim();
  if (!trimmed) return undefined;

  // ASCII 图 / 树状结构：保持无高亮，否则配色会打乱视觉结构
  if (DIAGRAM_CHARS.test(trimmed)) return undefined;

  // JSON —— 能解析就是铁证
  if (/^[[{]/.test(trimmed)) {
    try {
      JSON.parse(trimmed);
      return "json";
    } catch {
      // 不是合法 JSON，继续往下判断
    }
  }

  const looksLikeJs =
    /^\s*(?:const|let|var)\s+[$A-Za-z_]/m.test(trimmed) ||
    /=>/.test(trimmed) ||
    /^\s*(?:async\s+)?function\s*[*$A-Za-z_]/m.test(trimmed);

  // Python：必须有 Python 独有的强特征，避免和 JS/TS 抢
  const pythonSignals =
    /^\s*(?:async\s+)?def\s+[$A-Za-z_]\w*\s*\(/m.test(trimmed) ||
    /^\s*class\s+[$A-Za-z_]\w*(?:\([^)]*\))?\s*:/m.test(trimmed) ||
    /^\s*from\s+[\w.]+\s+import\s+/m.test(trimmed) ||
    /^\s*import\s+[\w.]+\s*$/m.test(trimmed) ||
    /\bprint\s*\(/.test(trimmed) ||
    /^\s*(?:for|while|if|elif|else|try|except|finally|with)\b[^\n]*:\s*$/m.test(
      trimmed,
    ) ||
    /\bself\./.test(trimmed) ||
    /\b(?:elif|None|True|False)\b/.test(trimmed);

  if (pythonSignals && !looksLikeJs) return "python";

  // TypeScript / JavaScript
  if (looksLikeJs) {
    const looksLikeTs =
      /^\s*(?:interface|type|enum)\s+[$A-Za-z_]\w*/m.test(trimmed) ||
      /:\s*(?:string|number|boolean|void|unknown|never|any)\b/.test(trimmed) ||
      /<[$A-Za-z_]\w*(?:\[\])?>(?=\s*[=(])/.test(trimmed) ||
      /\bas\s+(?:const|[$A-Z]\w+)/.test(trimmed);
    return looksLikeTs ? "typescript" : "javascript";
  }

  // Shell：提示符行，或常见的命令行开头
  if (
    /^\s*[$#>]\s+\S/m.test(trimmed) ||
    /^\s*(?:pnpm|npm|npx|yarn|git|cd|ls|cat|mkdir|rm|cp|mv|docker|pip|uv|curl|wget|grep|rg)\s/m.test(
      trimmed,
    )
  ) {
    return "bash";
  }

  // SQL
  if (
    /^\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE|DROP\s+TABLE)\b/im.test(
      trimmed,
    )
  ) {
    return "sql";
  }

  return undefined;
}

/**
 * 给没有语言标签的代码围栏补上语言。
 *
 * 无标签时**尽量识别真实语言**（让 Shiki 高亮），识别不出才退回 `text`。
 * 早期版本一律标 `text`，导致所有未标注的代码块都是纯灰色 —— 观感很差。
 *
 * 只改写开围栏，不动闭围栏。
 */
export function tagPlainCodeFenceOpenings(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let openTicks = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]!;
    const match = CODE_FENCE_PATTERN.exec(line);
    if (!match) {
      output.push(line);
      index += 1;
      continue;
    }

    const ticks = match[1]!;
    const info = (match[2] ?? "").trim();

    // 闭围栏：反引号数量需不少于开围栏，原样保留
    if (openTicks > 0) {
      if (ticks.length >= openTicks) openTicks = 0;
      output.push(line);
      index += 1;
      continue;
    }

    openTicks = ticks.length;
    // 已标注语言：原样保留
    if (info) {
      output.push(line);
      index += 1;
      continue;
    }

    // 无标签：向后收集正文用于识别（流式未闭合时收到底即可）
    const body: string[] = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const candidate = lines[cursor]!;
      const closing = CODE_FENCE_PATTERN.exec(candidate);
      if (closing && closing[1]!.length >= ticks.length) break;
      body.push(candidate);
      cursor += 1;
    }

    const language = detectFenceLanguage(body.join("\n")) ?? "text";
    output.push(`${ticks}${language}`);
    index += 1;
  }

  return output.join("\n");
}
