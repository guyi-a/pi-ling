import type { ChangedFile, FileDiff } from "@pi-ling/contracts";
import { useEffect, useRef, useState } from "react";

import { sourceDef } from "./changes-source";
import type { ChangesSourceId } from "./changes-source";
import { SourcePicker } from "./SourcePicker";
import { diffStats, UnifiedDiffView } from "./UnifiedDiffView";

const STATUS_LABEL: Record<ChangedFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

const AUTO_COLLAPSE_FILE_COUNT = 6;

export function ChangesView(props: {
  source: ChangesSourceId;
  files: ChangedFile[];
  getDiff: (path: string) => Promise<FileDiff | undefined>;
  onSourceChange: (source: ChangesSourceId) => void;
  loading?: boolean | undefined;
}) {
  const { source, files, getDiff, onSourceChange, loading } = props;
  const currentDef = sourceDef(source);
  const collapseByDefault = files.length > AUTO_COLLAPSE_FILE_COUNT;

  return (
    <aside className="changes-panel" aria-label="Changes">
      <div className="changes-header">
        <SourcePicker value={source} files={files} onChange={onSourceChange} />
        {!currentDef.enabled ? (
          <span className="changes-coming-soon">即将上线</span>
        ) : null}
      </div>

      {loading ? (
        <div className="changes-empty">
          <span className="changes-empty-mark">{currentDef.label.slice(0, 1)}</span>
          <strong>{currentDef.label}</strong>
          <p>正在加载变更…</p>
        </div>
      ) : files.length === 0 ? (
        <div className="changes-empty">
          <span className="changes-empty-mark">
            {currentDef.label.slice(0, 1)}
          </span>
          <strong>{currentDef.label}</strong>
          <p>当前来源没有可展示的文件变更。</p>
        </div>
      ) : (
        <div className="changes-files">
          {files.map((file) => (
            <FileSection
              file={file}
              getDiff={getDiff}
              defaultCollapsed={collapseByDefault}
              key={file.path}
            />
          ))}
        </div>
      )}
    </aside>
  );
}

function FileSection(props: {
  file: ChangedFile;
  getDiff: (path: string) => Promise<FileDiff | undefined>;
  defaultCollapsed: boolean;
}) {
  const { file, getDiff, defaultCollapsed } = props;
  const [diff, setDiff] = useState<FileDiff | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [shouldLoad, setShouldLoad] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const skipDiff =
    file.sensitive || file.binary || file.tooLarge;

  useEffect(() => {
    setCollapsed(defaultCollapsed);
    setDiff(undefined);
    setError(null);
    setShouldLoad(false);
  }, [defaultCollapsed, file.path]);

  useEffect(() => {
    if (collapsed || skipDiff) {
      setShouldLoad(false);
      return;
    }
    const node = bodyRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") {
      setShouldLoad(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [collapsed, skipDiff, file.path]);

  useEffect(() => {
    if (!shouldLoad || skipDiff) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void getDiff(file.path)
      .then((result) => {
        if (!cancelled) setDiff(result);
      })
      .catch((err) => {
        if (!cancelled) {
          setDiff(undefined);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file.path, getDiff, shouldLoad, skipDiff]);

  const stats = diff
    ? diffStats(diff.patch)
    : { additions: file.additions ?? 0, deletions: file.deletions ?? 0 };

  return (
    <section className="file-section" aria-label={file.path}>
      <button
        className="file-section-header"
        type="button"
        onClick={() => setCollapsed((current) => !current)}
        aria-expanded={!collapsed}
      >
        <span className={`file-chevron${collapsed ? " is-collapsed" : ""}`} />
        <span
          className={`file-status status-${file.status}`}
          title={file.status}
        >
          {STATUS_LABEL[file.status]}
        </span>
        <span className="file-path" title={file.path}>
          {file.path}
        </span>
        <span className="file-stat">
          {stats.additions > 0 ? (
            <span className="diff-add">+{stats.additions}</span>
          ) : null}
          {stats.deletions > 0 ? (
            <span className="diff-delete">-{stats.deletions}</span>
          ) : null}
        </span>
      </button>

      <div
        ref={bodyRef}
        className={`file-section-body${collapsed ? " is-collapsed" : ""}`}
      >
        {error ? (
          <div className="changes-empty-mini">{error}</div>
        ) : file.sensitive ? (
          <div className="changes-empty-mini">
            敏感文件只展示变更状态，不返回正文 Diff。
          </div>
        ) : file.binary ? (
          <div className="changes-empty-mini">
            二进制文件不提供行级 Diff。
          </div>
        ) : file.tooLarge ? (
          <div className="changes-empty-mini">
            文件过大，已跳过行级 Diff。
          </div>
        ) : loading ? (
          <div className="changes-empty-mini">加载 Diff…</div>
        ) : diff?.patch ? (
          <UnifiedDiffView
            patch={diff.patch}
            truncated={diff.truncated}
          />
        ) : shouldLoad ? (
          <div className="changes-empty-mini">
            该文件没有可展示的文本差异。
          </div>
        ) : null}
      </div>
    </section>
  );
}
