import type { ChangedFile, DiffFileContents, FileDiff } from "@pi-ling/contracts";
import { Columns2, Rows2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { MergeDiffView, type DiffLayout } from "../diff/MergeDiffView";
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
  /** 取 diff 双侧内容，用于 MergeDiffView；返回 undefined 时回退 patch 渲染。 */
  getDiffContents?:
    | ((path: string) => Promise<DiffFileContents | undefined>)
    | undefined;
  onSourceChange: (source: ChangesSourceId) => void;
  loading?: boolean | undefined;
}) {
  const { source, files, getDiff, getDiffContents, onSourceChange, loading } =
    props;
  const currentDef = sourceDef(source);
  const collapseByDefault = files.length > AUTO_COLLAPSE_FILE_COUNT;
  const [layout, setLayout] = useState<DiffLayout>("split");
  const canUseMergeView = Boolean(getDiffContents);
  /*
   * 只有「还没有任何内容可展示」时才用 loading 遮住面板。
   *
   * 后台刷新（agent 事件防抖触发）期间必须保留旧内容：一旦用 `loading` 无条件
   * 遮罩，面板会闪成「正在加载变更…」，且所有 FileSection 卸载重挂载、把每个
   * 文件的 diff 重新取一遍。实测清空方案在 t=60ms 时 sections=0、loading=1。
   */
  const showLoadingState = Boolean(loading) && files.length === 0;

  return (
    <aside className="changes-panel" aria-label="Changes">
      <div className="changes-header">
        <SourcePicker value={source} files={files} onChange={onSourceChange} />
        {!currentDef.enabled ? (
          <span className="changes-coming-soon">即将上线</span>
        ) : null}
        {canUseMergeView ? (
          <div className="diff-layout-toggle" role="group" aria-label="Diff 布局">
            <button
              type="button"
              className={`diff-layout-button${layout === "split" ? " is-active" : ""}`}
              aria-pressed={layout === "split"}
              title="左右对照"
              onClick={() => setLayout("split")}
            >
              <Columns2 size={13} />
            </button>
            <button
              type="button"
              className={`diff-layout-button${layout === "inline" ? " is-active" : ""}`}
              aria-pressed={layout === "inline"}
              title="单栏内联"
              onClick={() => setLayout("inline")}
            >
              <Rows2 size={13} />
            </button>
          </div>
        ) : null}
      </div>

      {showLoadingState ? (
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
              getDiffContents={getDiffContents}
              layout={layout}
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
  getDiffContents:
    | ((path: string) => Promise<DiffFileContents | undefined>)
    | undefined;
  layout: DiffLayout;
  defaultCollapsed: boolean;
}) {
  const { file, getDiff, getDiffContents, layout, defaultCollapsed } = props;
  const [diff, setDiff] = useState<FileDiff | undefined>(undefined);
  const [contents, setContents] = useState<DiffFileContents | undefined>(
    undefined,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [shouldLoad, setShouldLoad] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const skipDiff = file.sensitive || file.binary || file.tooLarge;

  /*
   * 只在**换文件**时清空已加载的 diff。
   *
   * 原先依赖里还有 `defaultCollapsed`，而它是「文件数 > 6」推导出来的 —— agent
   * 输出期间文件数在阈值附近波动时，所有 FileSection 会被反复清空重载。
   * 折叠状态属于「默认值」，只应在挂载时生效（key=file.path 变化会重挂载），
   * 不该在用户已经展开查看时把它收起来。
   */
  useEffect(() => {
    setDiff(undefined);
    setContents(undefined);
    setError(null);
    setShouldLoad(false);
  }, [file.path]);

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
    // patch 与双侧内容各取所需：任一侧拿到都能渲染，双双失败才算错误
    void Promise.all([
      getDiff(file.path).catch(() => undefined),
      getDiffContents
        ? getDiffContents(file.path).catch(() => undefined)
        : Promise.resolve(undefined),
    ])
      .then(([patchResult, contentsResult]) => {
        if (cancelled) return;
        setDiff(patchResult);
        setContents(contentsResult);
      })
      .catch((err) => {
        if (!cancelled) {
          setDiff(undefined);
          setContents(undefined);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [file.path, getDiff, getDiffContents, shouldLoad, skipDiff]);

  const stats = diff
    ? diffStats(diff.patch)
    : { additions: file.additions ?? 0, deletions: file.deletions ?? 0 };

  // 双侧内容可用时用带语法高亮的 MergeView，否则回退到 patch 渲染。
  // 两侧都为空（例如新增的空文件）没有可展示的差异，也走兜底路径。
  const showMergeView = Boolean(
    contents &&
      !contents.truncated &&
      (contents.before !== "" || contents.after !== "") &&
      getDiffContents,
  );

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
        ) : showMergeView && contents ? (
          <MergeDiffView
            path={file.path}
            before={contents.before}
            after={contents.after}
            layout={layout}
          />
        ) : diff?.patch ? (
          <UnifiedDiffView patch={diff.patch} truncated={diff.truncated} />
        ) : shouldLoad ? (
          <div className="changes-empty-mini">
            该文件没有可展示的文本差异。
          </div>
        ) : null}
      </div>
    </section>
  );
}
