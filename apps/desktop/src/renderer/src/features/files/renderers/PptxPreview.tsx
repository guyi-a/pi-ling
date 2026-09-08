import { useEffect, useRef, useState } from "react";

import {
  workspaceDownloadURL,
  workspaceInlineURL,
} from "../../../lib/workspace-url";

export function PptxPreview(props: {
  root: string;
  path: string;
  name: string;
  version?: number;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const viewerRef = useRef<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setError(null);

    if (viewerRef.current) {
      viewerRef.current.destroy();
      viewerRef.current = null;
    }
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

        const { PptxViewer, RECOMMENDED_ZIP_LIMITS } = await import(
          "@aiden0z/pptx-renderer"
        );
        if (ac.signal.aborted || !containerRef.current) return;

        const scrollContainer = containerRef.current?.parentElement;
        const viewer = new PptxViewer(containerRef.current, {
          fitMode: "contain",
          ...(scrollContainer ? { scrollContainer } : {}),
          zipLimits: RECOMMENDED_ZIP_LIMITS,
        });
        viewerRef.current = viewer;

        await viewer.open(buffer, {
          renderMode: "list",
          listOptions: { windowed: true, batchSize: 4 },
          signal: ac.signal,
        });

        if (!ac.signal.aborted) setLoading(false);
      } catch (err) {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : "pptx 加载失败");
        setLoading(false);
      }
    })();

    return () => {
      ac.abort();
      if (viewerRef.current) {
        viewerRef.current.destroy();
        viewerRef.current = null;
      }
    };
  }, [props.root, props.path, props.version]);

  if (error) {
    return (
      <div className="files-unsupported">
        <div className="files-unsupported-reason">pptx 预览失败：{error}</div>
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
    <div className="files-pptx">
      {loading ? (
        <div className="files-preview-loading">Loading…</div>
      ) : null}
      <div ref={containerRef} className="files-pptx-container" />
    </div>
  );
}
