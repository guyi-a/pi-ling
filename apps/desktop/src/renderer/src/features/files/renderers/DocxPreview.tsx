import { useEffect, useRef, useState } from "react";

import {
  workspaceDownloadURL,
  workspaceInlineURL,
} from "../../../lib/workspace-url";

const SYMBOL_PUA_MAP: Record<number, string> = {
  0xf0b7: "•",
  0xf0a7: "▪",
  0xf0a8: "■",
  0xf0fc: "✔",
  0xf0fb: "✔",
  0xf06f: "○",
  0xf0fe: "☑",
  0xf071: "●",
  0xf0a1: "●",
  0xf076: "❖",
  0xf0d8: "▲",
  0xf0e0: "✉",
  0xf0e8: "◆",
};

const SYMBOL_FONT_RE = /symbol|wingdings/i;

function escCssChar(ch: string): string {
  const code = ch.codePointAt(0);
  return code === undefined ? "" : `\\${code.toString(16)} `;
}

function fixSymbolChars(container: HTMLElement) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    const span = node.parentElement;
    if (!span || !SYMBOL_FONT_RE.test(span.style.fontFamily)) continue;

    let replaced = false;
    const text = node.nodeValue ?? "";
    const mapped = Array.from(text).map((ch) => {
      const code = ch.codePointAt(0);
      if (code === undefined) return ch;
      const sub = SYMBOL_PUA_MAP[code];
      if (sub) {
        replaced = true;
        return sub;
      }
      if (code >= 0xf000 && code <= 0xf0ff) {
        replaced = true;
        return "•";
      }
      return ch;
    });
    if (replaced) {
      node.nodeValue = mapped.join("");
      span.style.fontFamily = "inherit";
    }
  }

  container.querySelectorAll("style").forEach((style) => {
    let css = style.textContent ?? "";
    let changed = false;
    css = css.replace(/\\([Ff]0[0-9A-Fa-f]{2})/g, (_match, hex) => {
      const code = parseInt(hex, 16);
      const sub = SYMBOL_PUA_MAP[code];
      changed = true;
      return sub ? escCssChar(sub) : escCssChar("•");
    });
    css = css.replace(
      /font-family:\s*["']?(Symbol|Wingdings\d?)["']?/gi,
      () => {
        changed = true;
        return "font-family: inherit";
      },
    );
    if (changed) style.textContent = css;
  });
}

export function DocxPreview(props: {
  root: string;
  path: string;
  name: string;
  version?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    if (containerRef.current) containerRef.current.innerHTML = "";

    void (async () => {
      try {
        const url = workspaceInlineURL(props.root, props.path, {
          ...(props.version !== undefined ? { version: props.version } : {}),
        });
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        const buffer = await res.arrayBuffer();
        if (ac.signal.aborted) return;

        const { renderAsync } = await import("docx-preview");
        if (ac.signal.aborted || !containerRef.current) return;

        await renderAsync(buffer, containerRef.current, undefined, {
          inWrapper: false,
          ignoreWidth: true,
          ignoreHeight: true,
          breakPages: false,
          renderHeaders: false,
          renderFooters: false,
          renderFootnotes: true,
          renderEndnotes: true,
          useBase64URL: true,
        });
        if (ac.signal.aborted) return;
        fixSymbolChars(containerRef.current);
        setLoading(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "docx 加载失败");
        setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [props.root, props.path, props.version]);

  if (error) {
    return (
      <div className="files-unsupported">
        <div className="files-unsupported-reason">docx 预览失败：{error}</div>
        <a
          href={workspaceDownloadURL(props.root, props.path)}
          download={props.name}
          className="files-unsupported-download"
        >
          下载查看
        </a>
      </div>
    );
  }

  return (
    <div className="files-docx">
      {loading ? (
        <div className="files-preview-loading">Loading…</div>
      ) : null}
      <div ref={containerRef} className="files-docx-container" />
    </div>
  );
}
