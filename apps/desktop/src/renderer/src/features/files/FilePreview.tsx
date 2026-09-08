import { useEffect, useRef, useState } from "react";
import type { WorkspaceFileContent } from "@pi-ling/contracts";

import { FileSwitcherOverlay } from "./FileSwitcherOverlay";
import { CodePreview } from "./renderers/CodePreview";
import { DocxPreview } from "./renderers/DocxPreview";
import { ImageRenderer } from "./renderers/ImageRenderer";
import { MarkdownRenderer } from "./renderers/MarkdownRenderer";
import { MediaPreview } from "./renderers/MediaPreview";
import { PdfPreview } from "./renderers/PdfPreview";
import { PptxPreview } from "./renderers/PptxPreview";
import { isTablePath, TablePreview } from "./renderers/TablePreview";
import { UnsupportedRenderer } from "./renderers/UnsupportedRenderer";
import { useFilesStore } from "./store";

type InlineKind = "pdf" | "docx" | "pptx" | "video" | "audio";

const VIDEO_EXTS = new Set(["mp4", "webm", "ogv", "mov", "mkv", "m4v"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "m4a", "flac", "aac"]);

function detectInlineKind(path: string): InlineKind | null {
  const lower = path.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = lower.slice(dot + 1);
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "pptx") return "pptx";
  if (VIDEO_EXTS.has(ext)) return "video";
  if (AUDIO_EXTS.has(ext)) return "audio";
  return null;
}

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function CloseIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4 4 L12 12 M12 4 L4 12" />
    </svg>
  );
}

export function FilePreview(props: { root: string; path: string }) {
  const closePreview = useFilesStore((state) => state.closePreview);
  const previewLine = useFilesStore((state) => state.previewLine);
  const filesVersion = useFilesStore((state) => state.filesVersion);
  const switcherOpen = useFilesStore((state) => state.switcherOpen);
  const toggleSwitcher = useFilesStore((state) => state.toggleSwitcher);
  const pathButtonRef = useRef<HTMLButtonElement>(null);
  const inlineKind = detectInlineKind(props.path);
  const [file, setFile] = useState<WorkspaceFileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (inlineKind) {
      setFile(null);
      setError(null);
      setLoading(false);
      return;
    }
    const ac = new AbortController();
    setLoading(true);
    setError(null);
    setFile(null);
    void window.piLing
      .readFile(props.root, props.path)
      .then((result) => {
        if (ac.signal.aborted) return;
        if (result.kind === "missing") {
          closePreview();
          return;
        }
        setFile(result);
      })
      .catch((err) => {
        if (ac.signal.aborted) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
  }, [
    closePreview,
    filesVersion,
    inlineKind,
    props.path,
    props.root,
  ]);

  const name = basename(props.path);

  return (
    <div className="files-preview-shell">
      <div className="files-preview-header-wrap">
        <div className="files-preview-header">
          <button
            ref={pathButtonRef}
            type="button"
            className="files-preview-path"
            onClick={toggleSwitcher}
            aria-expanded={switcherOpen}
            aria-label="切换预览文件"
            title={props.path}
          >
            {props.path}
          </button>
          {file &&
          (file.kind === "markdown" ||
            file.kind === "text" ||
            file.kind === "image" ||
            file.kind === "binary" ||
            file.kind === "unsupported") ? (
            <span className="files-preview-size">{formatSize(file.size)}</span>
          ) : null}
          <button
            type="button"
            className="files-preview-close"
            onClick={closePreview}
            aria-label="关闭文件预览"
          >
            <CloseIcon />
          </button>
        </div>
        {switcherOpen ? (
          <FileSwitcherOverlay root={props.root} anchorRef={pathButtonRef} />
        ) : null}
      </div>

      <div className="files-preview">
        {inlineKind === "pdf" ? (
          <PdfPreview
            root={props.root}
            path={props.path}
            version={filesVersion}
          />
        ) : null}
        {inlineKind === "docx" ? (
          <DocxPreview
            root={props.root}
            path={props.path}
            name={name}
            version={filesVersion}
          />
        ) : null}
        {inlineKind === "pptx" ? (
          <PptxPreview
            root={props.root}
            path={props.path}
            name={name}
            version={filesVersion}
          />
        ) : null}
        {inlineKind === "video" ? (
          <MediaPreview
            root={props.root}
            path={props.path}
            name={name}
            kind="video"
            version={filesVersion}
          />
        ) : null}
        {inlineKind === "audio" ? (
          <MediaPreview
            root={props.root}
            path={props.path}
            name={name}
            kind="audio"
            version={filesVersion}
          />
        ) : null}

        {!inlineKind && loading ? (
          <div className="files-preview-empty">Loading…</div>
        ) : null}
        {!inlineKind && error ? (
          <div className="files-preview-error">加载失败：{error}</div>
        ) : null}
        {!inlineKind && !loading && !error && file ? (
          <>
            {file.kind === "markdown" ? (
              <MarkdownRenderer content={file.content} />
            ) : null}
            {file.kind === "text" ? (
              isTablePath(file.path) ? (
                <TablePreview content={file.content} path={file.path} />
              ) : (
                <CodePreview
                  content={file.content}
                  fileName={file.name}
                  highlightLine={previewLine}
                />
              )
            ) : null}
            {file.kind === "image" ? (
              <ImageRenderer root={props.root} path={file.path} name={file.name} />
            ) : null}
            {file.kind === "binary" || file.kind === "unsupported" ? (
              <UnsupportedRenderer
                root={props.root}
                path={file.path}
                name={file.name}
                size={file.size}
                reason={
                  file.kind === "binary"
                    ? "非文本文件"
                    : "暂不支持此类型预览"
                }
              />
            ) : null}
            {file.kind === "error" ? (
              <div className="files-preview-error">读取失败：{file.message}</div>
            ) : null}
            {file.kind === "missing" ? (
              <div className="files-preview-empty">文件不存在或已被删除。</div>
            ) : null}
          </>
        ) : null}
      </div>

      {file &&
      (file.kind === "markdown" || file.kind === "text") &&
      file.truncated ? (
        <div className="files-preview-truncated">
          truncated at 512 KB · 完整文件 {formatSize(file.size)}
        </div>
      ) : null}
    </div>
  );
}
