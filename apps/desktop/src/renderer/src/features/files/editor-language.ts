/**
 * 文件扩展名 → CodeMirror 语言。
 *
 * 未知或无法解析的一律回退 `plaintext`（不猜测内容）。
 *
 * 相对旧的 shiki 映射有所改进：旧实现因为只装了少量 shiki 语言包，把
 * go / rust / c++ 等统统映射成 `javascript` 作为占位。CodeMirror 有对应的
 * 语言包，因此这里给出真实映射。
 */

export type EditorLanguageId =
  | "javascript"
  | "json"
  | "markdown"
  | "python"
  | "html"
  | "css"
  | "sql"
  | "yaml"
  | "java"
  | "php"
  | "rust"
  | "go"
  | "cpp"
  | "plaintext";

const EXTENSION_MAP: Readonly<Record<string, EditorLanguageId>> = {
  ts: "javascript",
  tsx: "javascript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  mts: "javascript",
  cts: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  py: "python",
  html: "html",
  htm: "html",
  css: "css",
  scss: "css",
  less: "css",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  toml: "yaml",
  java: "java",
  php: "php",
  rs: "rust",
  go: "go",
  c: "cpp",
  h: "cpp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
};

/**
 * 判定文件的编辑器语言。
 *
 * @param fileName 文件名或相对路径均可（只取最后一段）。
 */
export function resolveEditorLanguage(fileName: string): EditorLanguageId {
  if (!fileName) return "plaintext";
  const base = fileName.split(/[/\\]/).pop() ?? "";
  const lower = base.toLowerCase();
  if (!lower) return "plaintext";

  const dot = lower.lastIndexOf(".");
  if (dot < 0) return "plaintext";
  return EXTENSION_MAP[lower.slice(dot + 1)] ?? "plaintext";
}
