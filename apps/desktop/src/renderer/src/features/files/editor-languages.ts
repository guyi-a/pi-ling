import type { Extension } from "@codemirror/state";

import type { EditorLanguageId } from "./editor-language";

/**
 * 按需加载语言解析器。
 *
 * 采用动态 `import()` 而不是静态导入：编辑器首屏只需要 chrome 与主题，
 * 语言包（尤其 cpp / java / php 这类体积较大的）应当等真正打开对应文件
 * 时才加载。加载失败时返回 `undefined`，编辑器退化为纯文本，不阻塞打开。
 */
export async function loadLanguageExtension(
  id: EditorLanguageId,
): Promise<Extension | undefined> {
  try {
    switch (id) {
      case "javascript": {
        const { javascript } = await import("@codemirror/lang-javascript");
        return javascript({ jsx: true, typescript: true });
      }
      case "json": {
        const { json } = await import("@codemirror/lang-json");
        return json();
      }
      case "markdown": {
        const { markdown } = await import("@codemirror/lang-markdown");
        return markdown();
      }
      case "python": {
        const { python } = await import("@codemirror/lang-python");
        return python();
      }
      case "html": {
        const { html } = await import("@codemirror/lang-html");
        return html();
      }
      case "css": {
        const { css } = await import("@codemirror/lang-css");
        return css();
      }
      case "sql": {
        const { sql } = await import("@codemirror/lang-sql");
        return sql();
      }
      case "yaml": {
        const { yaml } = await import("@codemirror/lang-yaml");
        return yaml();
      }
      case "java": {
        const { java } = await import("@codemirror/lang-java");
        return java();
      }
      case "php": {
        const { php } = await import("@codemirror/lang-php");
        return php();
      }
      case "rust": {
        const { rust } = await import("@codemirror/lang-rust");
        return rust();
      }
      case "go": {
        const { go } = await import("@codemirror/lang-go");
        return go();
      }
      case "cpp": {
        const { cpp } = await import("@codemirror/lang-cpp");
        return cpp();
      }
      case "plaintext":
        return undefined;
      default:
        return undefined;
    }
  } catch {
    // 语言包缺失或加载失败都不应阻断编辑
    return undefined;
  }
}
