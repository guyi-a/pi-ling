import type { ChangedFile, FileDiff } from "@pi-ling/contracts";
import { useEffect, useState } from "react";

import { sourceDef } from "./changes-source";
import type { ChangesSourceId } from "./changes-source";
import { SourcePicker } from "./SourcePicker";
import { diffStats, UnifiedDiffView } from "./UnifiedDiffView";

const STATUS_LABEL: Record<ChangedFile["status"], string> = {
  added: "A",
  modified: "M",
  deleted: "D",
};

export function ChangesView(props: {
  source: ChangesSourceId;
  files: ChangedFile[];
  getDiff: (path: string) => Promise<FileDiff | undefined>;
  onSourceChange: (source: ChangesSourceId) => void;
  loading?: boolean;
}) {
  const { source, files, getDiff, onSourceChange } = props;
  const currentDef = sourceDef(source);

  return (
    <aside className="changes-panel" aria-label="Changes">
      <div className="changes-header">
        <SourcePicker value={source} files={files} onChange={onSourceChange} />
        {!currentDef.enabled ? (
          <span className="changes-coming-soon">即将上线</span>
        ) : null}
      </div>

      {files.length === 0 ? (
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
}) {
  const { file, getDiff } = props;
  const [diff, setDiff] = useState<FileDiff | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, [file.path, getDiff]);

  const stats = diff
    ? diffStats(diff.patch)
    : { additions: file.additions ?? 0, deletions: file.deletions ?? 0 };

  return (
    <section className="file-section" aria-label={file.path}>
      <div className="file-section-header">
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
      </div>

      <div className="file-section-body">
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
        ) : (
          <div className="changes-empty-mini">
            该文件没有可展示的文本差异。
          </div>
        )}
      </div>
    </section>
  );
}
