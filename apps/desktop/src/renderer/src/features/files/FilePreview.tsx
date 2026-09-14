import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceFileContent } from "@pi-ling/contracts";

import { CodeEditor, type CodeEditorHandle } from "./CodeEditor";
import { pickFileView, resolveFileViews, type FileViewMode } from "./file-views";
import { FileSwitcherOverlay } from "./FileSwitcherOverlay";
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

/**
 * Preview / Source 切换。仅在文件支持两种视图时渲染。
 *
 * 图标沿用 Cursor 的语义：眼睛 = 预览，代码括号 = 源码。
 */
function ViewToggle(props: {
  views: readonly FileViewMode[];
  value: FileViewMode | undefined;
  onChange: (mode: FileViewMode) => void;
}) {
  if (props.views.length < 2 || !props.value) return null;
  const options: Array<{ mode: FileViewMode; label: string }> = [
    { mode: "preview", label: "Preview" },
    { mode: "source", label: "Source" },
  ];
  return (
    <div className="files-view-toggle" role="group" aria-label="视图模式">
      {options
        .filter((option) => props.views.includes(option.mode))
        .map((option) => (
          <button
            key={option.mode}
            type="button"
            className={`files-view-toggle-button${
              props.value === option.mode ? " is-active" : ""
            }`}
            aria-pressed={props.value === option.mode}
            onClick={() => props.onChange(option.mode)}
          >
            {option.label}
          </button>
        ))}
    </div>
  );
}

export function FilePreview(props: { root: string; path: string }) {
  const closePreview = useFilesStore((state) => state.closePreview);
  const requestClosePreview = useFilesStore(
    (state) => state.requestClosePreview,
  );
  const previewLine = useFilesStore((state) => state.previewLine);
  const switcherOpen = useFilesStore((state) => state.switcherOpen);
  const toggleSwitcher = useFilesStore((state) => state.toggleSwitcher);
  const viewModePreference = useFilesStore((state) => state.viewMode);
  const setViewMode = useFilesStore((state) => state.setViewMode);
  const dirty = useFilesStore((state) => state.dirty);
  const setDirty = useFilesStore((state) => state.setDirty);
  const pendingPath = useFilesStore((state) => state.pendingPath);
  const pendingClose = useFilesStore((state) => state.pendingClose);
  const discardPending = useFilesStore((state) => state.discardPending);
  const cancelPending = useFilesStore((state) => state.cancelPending);
  const refreshTree = useFilesStore((state) => state.refreshTree);

  const pathButtonRef = useRef<HTMLButtonElement>(null);
  const loadedPathRef = useRef<string | null>(null);
  const editorRef = useRef<CodeEditorHandle | null>(null);
  const inlineKind = detectInlineKind(props.path);
  const [file, setFile] = useState<WorkspaceFileContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (inlineKind) {
      loadedPathRef.current = null;
      setFile(null);
      setError(null);
      setLoading(false);
      return;
    }
    const pathChanged = loadedPathRef.current !== props.path;
    if (pathChanged) {
      loadedPathRef.current = props.path;
      setFile(null);
      setLoading(true);
      setSaveError(null);
    }
    const ac = new AbortController();
    setError(null);
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
  }, [closePreview, inlineKind, props.path, props.root]);

  const name = basename(props.path);

  // 只有 text / markdown 才有视图切换；missing 与 error 没有 path 字段
  const views =
    file && (file.kind === "text" || file.kind === "markdown")
      ? resolveFileViews({ kind: file.kind, path: file.path })
      : [];
  const activeView = pickFileView(views, viewModePreference);
  const truncated = Boolean(file && "truncated" in file && file.truncated);

  const handleSave = useCallback(async () => {
    if (!file || (file.kind !== "text" && file.kind !== "markdown")) return;
    const content = editorRef.current?.getValue();
    if (content === undefined) return;
    const result = await window.piLing.writeFile(
      props.root,
      file.path,
      content,
    );
    if (!result.ok) {
      setSaveError(result.message);
      return;
    }
    setSaveError(null);
    setDirty(false);
    // 保存后同步本地内容：切到 Preview 或重开编辑器时用的是最新文本
    setFile((current) =>
      current && (current.kind === "text" || current.kind === "markdown")
        ? { ...current, content, size: result.size }
        : current,
    );
    refreshTree();
  }, [file, props.root, refreshTree, setDirty]);

  // 挂起的导航：保存后继续前往目标
  const handleSaveAndProceed = useCallback(async () => {
    await handleSave();
    // handleSave 失败时会 setSaveError 且 dirty 仍为 true，此处不继续跳转
    if (useFilesStore.getState().dirty) return;
    discardPending();
  }, [discardPending, handleSave]);

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
          {dirty ? (
            <span
              className="files-preview-dirty"
              title="有未保存的更改"
              aria-label="有未保存的更改"
            />
          ) : null}
          {file &&
          (file.kind === "markdown" ||
            file.kind === "text" ||
            file.kind === "image" ||
            file.kind === "binary" ||
            file.kind === "unsupported") ? (
            <span className="files-preview-size">{formatSize(file.size)}</span>
          ) : null}
          <ViewToggle
            views={views}
            value={activeView}
            onChange={setViewMode}
          />
          <button
            type="button"
            className="files-preview-close"
            onClick={requestClosePreview}
            aria-label="关闭文件预览"
          >
            <CloseIcon />
          </button>
        </div>
        {pendingPath || pendingClose ? (
          <div className="files-unsaved-bar" role="alert">
            <span className="files-unsaved-text">
              {pendingClose ? "有未保存的更改" : `未保存：${basename(props.path)}`}
            </span>
            <div className="files-unsaved-actions">
              <button
                type="button"
                className="files-unsaved-save"
                onClick={() => void handleSaveAndProceed()}
              >
                保存并打开
              </button>
              <button
                type="button"
                className="files-unsaved-discard"
                onClick={discardPending}
              >
                放弃更改
              </button>
              <button
                type="button"
                className="files-unsaved-cancel"
                onClick={cancelPending}
              >
                取消
              </button>
            </div>
          </div>
        ) : null}
        {switcherOpen ? (
          <FileSwitcherOverlay root={props.root} anchorRef={pathButtonRef} />
        ) : null}
      </div>

      <div className="files-preview">
        {inlineKind === "pdf" ? (
          <PdfPreview root={props.root} path={props.path} />
        ) : null}
        {inlineKind === "docx" ? (
          <DocxPreview root={props.root} path={props.path} name={name} />
        ) : null}
        {inlineKind === "pptx" ? (
          <PptxPreview root={props.root} path={props.path} name={name} />
        ) : null}
        {inlineKind === "video" ? (
          <MediaPreview
            root={props.root}
            path={props.path}
            name={name}
            kind="video"
          />
        ) : null}
        {inlineKind === "audio" ? (
          <MediaPreview
            root={props.root}
            path={props.path}
            name={name}
            kind="audio"
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
            {file.kind === "markdown" && activeView === "preview" ? (
              <MarkdownRenderer content={file.content} />
            ) : null}
            {file.kind === "text" &&
            activeView === "preview" &&
            isTablePath(file.path) ? (
              <TablePreview content={file.content} path={file.path} />
            ) : null}
            {/* 源码视图：可编辑；截断的超大文件只读，避免保存出半截内容 */}
            {activeView === "source" &&
            (file.kind === "text" || file.kind === "markdown") ? (
              <>
                {truncated ? (
                  <div className="files-editor-readonly-note">
                    文件过大，仅显示前 512 KB，已切换为只读。
                  </div>
                ) : null}
                <CodeEditor
                  path={file.path}
                  value={file.content}
                  readOnly={truncated}
                  highlightLine={previewLine}
                  onChange={() => setDirty(true)}
                  onSave={() => void handleSave()}
                  handleRef={editorRef}
                />
              </>
            ) : null}
            {/* 纯文本与 Markdown 的源码视图统一走 CodeEditor(cf. 只读的旧 CodePreview) */}
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

      {saveError ? (
        <div className="files-preview-truncated">保存失败：{saveError}</div>
      ) : null}
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
