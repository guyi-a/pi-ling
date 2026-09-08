import { useEffect, useRef, useState } from "react";

import { highlightCode, resolveLanguage } from "../../../lib/shiki";

function CodeFallback(props: { content: string }) {
  const lines = props.content.split("\n");
  return (
    <div className="files-code-fallback">
      {lines.map((line, index) => (
        <div className="files-code-line" key={index}>
          <span className="files-code-gutter">{index + 1}</span>
          <span className="files-code-content">{line || " "}</span>
        </div>
      ))}
    </div>
  );
}

function readThemeDark(): boolean {
  return document.documentElement.dataset.theme !== "light";
}

export function CodePreview(props: {
  content: string;
  fileName: string;
  highlightLine?: number | null;
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    const lang = resolveLanguage(props.fileName);
    const dark = readThemeDark();
    void highlightCode(props.content, lang, { showLineNumbers: true, dark })
      .then((value) => {
        if (!cancelled) {
          setHtml(value);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHtml(null);
          setFailed(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.content, props.fileName]);

  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => {
      const lang = resolveLanguage(props.fileName);
      const dark = readThemeDark();
      void highlightCode(props.content, lang, {
        showLineNumbers: true,
        dark,
      }).then((value) => setHtml(value));
    });
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [props.content, props.fileName]);

  useEffect(() => {
    if (!html || !props.highlightLine || !hostRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      const host = hostRef.current;
      if (!host) return;
      host
        .querySelectorAll(".shiki-line-target")
        .forEach((node) => node.classList.remove("shiki-line-target"));
      const line = host.querySelector<HTMLElement>(
        `.line[data-line="${props.highlightLine}"]`,
      );
      if (!line) return;
      line.classList.add("shiki-line-target");
      line.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [props.highlightLine, html]);

  if (html) {
    return (
      <div
        ref={hostRef}
        className="files-shiki-host"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  if (failed) {
    return <CodeFallback content={props.content} />;
  }

  return <div className="files-preview-loading">Loading…</div>;
}
