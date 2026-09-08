import {
  createHighlighterCore,
  type HighlighterCore,
  type ShikiTransformer,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import type { BundledLanguage, BundledTheme, LanguageInput } from "shiki";

const THEME_LIGHT: BundledTheme = "github-light";
const THEME_DARK: BundledTheme = "github-dark";
const FALLBACK_LANG: BundledLanguage = "typescript";

const LANG_BY_EXT: Record<string, BundledLanguage> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  mts: "typescript",
  cts: "typescript",
  go: "javascript",
  py: "python",
  rb: "javascript",
  rs: "javascript",
  java: "java",
  kt: "javascript",
  swift: "javascript",
  c: "javascript",
  h: "javascript",
  cpp: "javascript",
  cc: "javascript",
  cxx: "javascript",
  hpp: "javascript",
  json: "json",
  jsonc: "jsonc",
  yaml: "yaml",
  yml: "yaml",
  toml: "yaml",
  xml: "xml",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  env: "bash",
  sql: "sql",
  php: "php",
  md: "markdown",
  markdown: "markdown",
  ini: "javascript",
  dockerfile: "bash",
};

type LangModule = { default: LanguageInput };

function importLang(id: string): Promise<LangModule> {
  switch (id) {
    case "typescript":
      return import("@shikijs/langs/typescript");
    case "tsx":
      return import("@shikijs/langs/tsx");
    case "javascript":
      return import("@shikijs/langs/javascript");
    case "jsx":
      return import("@shikijs/langs/jsx");
    case "json":
      return import("@shikijs/langs/json");
    case "jsonc":
      return import("@shikijs/langs/jsonc");
    case "markdown":
      return import("@shikijs/langs/markdown");
    case "bash":
      return import("@shikijs/langs/bash");
    case "python":
      return import("@shikijs/langs/python");
    case "html":
      return import("@shikijs/langs/html");
    case "css":
      return import("@shikijs/langs/css");
    case "scss":
      return import("@shikijs/langs/scss");
    case "yaml":
      return import("@shikijs/langs/yaml");
    case "xml":
      return import("@shikijs/langs/xml");
    case "sql":
      return import("@shikijs/langs/sql");
    case "php":
      return import("@shikijs/langs/php");
    case "java":
      return import("@shikijs/langs/java");
    default:
      return import("@shikijs/langs/typescript");
  }
}

export function resolveLanguage(filePathOrName: string): BundledLanguage {
  if (!filePathOrName) return FALLBACK_LANG;
  const fileName = filePathOrName.split(/[/\\]/).pop() ?? "";
  const lower = fileName.toLowerCase();
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) {
    return "bash";
  }
  if (lower === "makefile" || lower === "gnumakefile") {
    return "bash";
  }
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return FALLBACK_LANG;
  const ext = fileName.slice(dot + 1).toLowerCase();
  return LANG_BY_EXT[ext] ?? FALLBACK_LANG;
}

let highlighterPromise: Promise<HighlighterCore> | null = null;

async function createCoreHighlighter(): Promise<HighlighterCore> {
  const [lightTheme, darkTheme] = await Promise.all([
    import("@shikijs/themes/github-light"),
    import("@shikijs/themes/github-dark"),
  ]);
  return createHighlighterCore({
    themes: [lightTheme.default, darkTheme.default],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  });
}

async function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createCoreHighlighter().catch((error) => {
      highlighterPromise = null;
      throw error;
    });
  }
  return highlighterPromise;
}

async function ensureLanguage(
  hl: HighlighterCore,
  lang: BundledLanguage,
): Promise<BundledLanguage> {
  if (hl.getLoadedLanguages().includes(lang)) {
    return lang;
  }
  try {
    const mod: LangModule = await importLang(lang);
    await hl.loadLanguage(mod.default);
    if (hl.getLoadedLanguages().includes(lang)) {
      return lang;
    }
  } catch {
    /* fall through */
  }
  if (!hl.getLoadedLanguages().includes(FALLBACK_LANG)) {
    const fallback: LangModule = await importLang(FALLBACK_LANG);
    await hl.loadLanguage(fallback.default);
  }
  return hl.getLoadedLanguages().includes(FALLBACK_LANG)
    ? FALLBACK_LANG
    : ((hl.getLoadedLanguages()[0] as BundledLanguage | undefined) ??
      FALLBACK_LANG);
}

export function warmShikiHighlighter(): void {
  void getHighlighter();
}

export async function highlightCode(
  code: string,
  lang: BundledLanguage,
  options?: { showLineNumbers?: boolean; dark?: boolean },
): Promise<string> {
  const hl = await getHighlighter();
  const actualLang = await ensureLanguage(hl, lang);
  const transformers: ShikiTransformer[] = options?.showLineNumbers
    ? [lineNumberTransformer()]
    : [];
  const html = hl.codeToHtml(code, {
    lang: actualLang,
    theme: options?.dark ? THEME_DARK : THEME_LIGHT,
    transformers,
  });
  return html
    .replace(/<\/span>\n<span class="line">/g, '</span><span class="line">')
    .replace(/(<code[^>]*>)\n<span class="line">/g, '$1<span class="line">')
    .replace(/<\/span>\n<\/code>/g, "</span></code>");
}

function lineNumberTransformer(): ShikiTransformer {
  return {
    name: "line-numbers",
    line(node, line) {
      node.properties["data-line"] = String(line);
      node.children.unshift({
        type: "element",
        tagName: "span",
        properties: { className: ["shiki-line-no"] },
        children: [{ type: "text", value: String(line) }],
      });
    },
  };
}
