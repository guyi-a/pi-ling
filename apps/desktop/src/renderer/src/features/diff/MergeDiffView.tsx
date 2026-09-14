import { useEffect, useRef } from "react";
import { MergeView, unifiedMergeView } from "@codemirror/merge";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";

import { currentEditorTheme, observeThemeChange } from "../files/editor-theme";
import { resolveEditorLanguage } from "../files/editor-language";
import { loadLanguageExtension } from "../files/editor-languages";

export type DiffLayout = "split" | "inline";

/** 只读 + 主题 = 两侧共用的基础扩展。主题各自一个 Compartment（不能跨 state 复用）。 */
function baseExtensions(themeCompartment: Compartment): Extension[] {
  return [
    lineNumbers(),
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    themeCompartment.of(currentEditorTheme()),
  ];
}

interface DiffInstance {
  destroy(): void;
  /** 主题切换后重新配置（跟随 `html[data-theme]`）。 */
  refreshTheme(): void;
}

/**
 * 是否需要把 `from` 的滚动位置镜像到 `to`。
 *
 * 用「值比较」而不是布尔锁：赋值触发的 scroll 事件是异步的，布尔锁在
 * 同一帧内复位挡不住回声；值比较天然幂等，不会来回打架。
 * 1px 容差是因为浏览器在高分屏上会给出小数滚动值。
 */
export function shouldMirrorScroll(
  from: { scrollTop: number; scrollLeft: number },
  to: { scrollTop: number; scrollLeft: number },
): boolean {
  return (
    Math.abs(to.scrollTop - from.scrollTop) >= 1 ||
    Math.abs(to.scrollLeft - from.scrollLeft) >= 1
  );
}

/**
 * 让两个 pane 的滚动保持对齐。
 *
 * `@codemirror/merge` 本身**不做滚动同步**（6.12.2 实测：只同步了
 * 跳转到 chunk 时的 scrollIntoView）。对审阅场景这很致命 —— 左栏滚了
 * 右栏不动，就没法逐行对照。这里手动镜像 scrollTop / scrollLeft。
 */
export function syncScroll(a: HTMLElement, b: HTMLElement): () => void {
  const mirror = (from: HTMLElement, to: HTMLElement) => () => {
    if (!shouldMirrorScroll(from, to)) return;
    to.scrollTop = from.scrollTop;
    to.scrollLeft = from.scrollLeft;
  };
  const onA = mirror(a, b);
  const onB = mirror(b, a);
  a.addEventListener("scroll", onA);
  b.addEventListener("scroll", onB);
  return () => {
    a.removeEventListener("scroll", onA);
    b.removeEventListener("scroll", onB);
  };
}

/**
 * 只读的 diff 视图，基于 `@codemirror/merge`。
 *
 * 相对原来的手写单色 patch 渲染，这里带来：
 * - **语法高亮**：两侧都按文件类型着色
 * - **字符级高亮**：`highlightChanges` 把改动精确到词
 * - **split / inline 两种布局**：split 用 `MergeView`，inline 用 `unifiedMergeView`
 *
 * 这是**审阅面**，不是编辑面：两侧都锁成只读，也不提供 accept/reject 按钮。
 */
export function MergeDiffView(props: {
  path: string;
  before: string;
  after: string;
  layout: DiffLayout;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const instanceRef = useRef<DiffInstance | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let instance: DiffInstance | null = null;

    void (async () => {
      const language = resolveEditorLanguage(props.path);
      const languageExtension =
        language === "plaintext"
          ? undefined
          : await loadLanguageExtension(language);
      if (cancelled) return;
      const languageExtensions: Extension[] = languageExtension
        ? [languageExtension]
        : [];

      if (props.layout === "split") {
        const compartmentA = new Compartment();
        const compartmentB = new Compartment();
        const merge = new MergeView({
          parent: host,
          a: {
            doc: props.before,
            extensions: [...baseExtensions(compartmentA), ...languageExtensions],
          },
          b: {
            doc: props.after,
            extensions: [...baseExtensions(compartmentB), ...languageExtensions],
          },
          orientation: "a-b",
          // 字符级高亮
          highlightChanges: true,
          gutter: true,
          // 长段未改动折叠，聚焦真正的 diff
          collapseUnchanged: { margin: 3, minSize: 4 },
          // 审阅面不提供回退按钮（回退属于「合并」，不属于「审阅」）
        });
        const stopSync = syncScroll(merge.a.scrollDOM, merge.b.scrollDOM);
        instance = {
          destroy: () => {
            stopSync();
            merge.destroy();
          },
          refreshTheme: () => {
            merge.a.dispatch({
              effects: compartmentA.reconfigure(currentEditorTheme()),
            });
            merge.b.dispatch({
              effects: compartmentB.reconfigure(currentEditorTheme()),
            });
          },
        };
      } else {
        // inline：单栏，把 before 作为 original 叠在 after 上，删除行内联展示
        const compartment = new Compartment();
        const view = new EditorView({
          parent: host,
          state: EditorState.create({
            doc: props.after,
            extensions: [
              ...baseExtensions(compartment),
              ...languageExtensions,
              unifiedMergeView({
                original: props.before,
                // 审阅面：不要 accept/reject 按钮
                mergeControls: false,
                highlightChanges: true,
                gutter: true,
                collapseUnchanged: { margin: 3, minSize: 4 },
              }),
            ],
          }),
        });
        instance = {
          destroy: () => view.destroy(),
          refreshTheme: () =>
            view.dispatch({
              effects: compartment.reconfigure(currentEditorTheme()),
            }),
        };
      }

      if (cancelled) {
        instance.destroy();
        return;
      }
      instanceRef.current = instance;
    })();

    const stopObserving = observeThemeChange(() => {
      instanceRef.current?.refreshTheme();
    });

    return () => {
      cancelled = true;
      stopObserving();
      instanceRef.current = null;
      instance?.destroy();
      // MergeView / EditorView 会自行摘除 DOM，清空残留防止主题切换后叠加
      host.replaceChildren();
    };
  }, [props.after, props.before, props.layout, props.path]);

  return (
    <div
      className={`merge-diff-view merge-diff-view-${props.layout}`}
      ref={hostRef}
    />
  );
}
