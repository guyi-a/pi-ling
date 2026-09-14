import { useEffect, useRef } from "react";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, Compartment, StateEffect, StateField, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
  type DecorationSet,
} from "@codemirror/view";

import { currentEditorTheme, observeThemeChange } from "./editor-theme";
import { resolveEditorLanguage } from "./editor-language";
import { loadLanguageExtension } from "./editor-languages";

/**
 * 从聊天里的文件引用跳转过来时，高亮目标行。
 * 对应旧 shiki 实现里的 `.shiki-line-target`，让用户一眼看到被引用的位置。
 */
const setHighlightLine = StateEffect.define<number | null>();

const highlightLineField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (!effect.is(setHighlightLine)) continue;
      if (effect.value === null) {
        next = Decoration.none;
        continue;
      }
      const total = transaction.state.doc.lines;
      const line = Math.min(Math.max(1, effect.value), total);
      const info = transaction.state.doc.line(line);
      next = Decoration.set([
        Decoration.line({ class: "cm-referenced-line" }).range(info.from),
      ]);
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

export interface CodeEditorHandle {
  /** 取当前编辑器内容（保存时用），比受控 value 更可靠。 */
  getValue(): string;
  focus(): void;
}

/** 编辑器的选区快照。`anchor` 是视口坐标，用于摆放浮动按钮。 */
export interface EditorSelection {
  text: string;
  startLine: number;
  endLine: number;
  anchor: { left: number; top: number; right: number; bottom: number };
}

/**
 * 读取当前选区。
 *
 * 用 `coordsAtPos` 而不是 DOM 的 `getBoundingClientRect`：CodeMirror 有虚拟滚动，
 * 只有它自己知道某个文档位置对应屏幕上的哪个点。取选区**终点**的坐标作为锚点，
 * 拖选到哪儿按钮就跟到哪儿。
 */
function computeEditorSelection(view: EditorView): EditorSelection | null {
  const range = view.state.selection.main;
  if (range.empty) return null;
  const text = view.state.sliceDoc(range.from, range.to);
  // 纯空白选区没有引用价值，静默忽略（例如整行 Tab 缩进）
  if (!text.trim()) return null;

  const start = view.coordsAtPos(range.from);
  const end = view.coordsAtPos(range.to, 1) ?? start;
  if (!start || !end) return null;

  return {
    text,
    startLine: view.state.doc.lineAt(range.from).number,
    endLine: view.state.doc.lineAt(range.to).number,
    anchor: { left: end.left, top: end.top, right: end.right, bottom: end.bottom },
  };
}

export function CodeEditor(props: {
  /** 文件路径，用于语言判定与「换文件时重建」。 */
  path: string;
  /** 初始内容。仅在挂载或换文件时读取，之后由 CodeMirror 自己持有。 */
  value: string;
  readOnly?: boolean;
  /** 打开时滚动并高亮到该行（来自聊天里的文件引用）。 */
  highlightLine?: number | null;
  onChange?: (value: string) => void;
  onSave?: () => void;
  /** 选区变化时回调；无有效选区（收起 / 全空白）时为 null。 */
  onSelectionChange?: (selection: EditorSelection | null) => void;
  handleRef?: { current: CodeEditorHandle | null };
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef(new Compartment());
  const languageCompartmentRef = useRef(new Compartment());

  // 回调放 ref，避免每次 render 都重建编辑器
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const onSaveRef = useRef(props.onSave);
  onSaveRef.current = props.onSave;
  const onSelectionRef = useRef(props.onSelectionChange);
  onSelectionRef.current = props.onSelectionChange;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const themeCompartment = themeCompartmentRef.current;
    const languageCompartment = languageCompartmentRef.current;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current?.(update.state.doc.toString());
      }
      if (update.selectionSet || update.docChanged) {
        onSelectionRef.current?.(computeEditorSelection(update.view));
      }
    });

    const saveKeymap = keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          onSaveRef.current?.();
          return true;
        },
      },
    ]);

    const state = EditorState.create({
      doc: props.value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        bracketMatching(),
        rectangularSelection(),
        highlightActiveLine(),
        search(),
        highlightSelectionMatches(),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        saveKeymap,
        updateListener,
        themeCompartment.of(currentEditorTheme()),
        languageCompartment.of([]),
        highlightLineField,
        EditorView.editable.of(!props.readOnly),
        EditorState.readOnly.of(Boolean(props.readOnly)),
      ],
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    // 语言包按需异步加载，避免把所有解析器打进首屏
    const language = resolveEditorLanguage(props.path);
    if (language !== "plaintext") {
      let cancelled = false;
      void loadLanguageExtension(language).then((extension) => {
        if (cancelled || !extension) return;
        view.dispatch({
          effects: languageCompartment.reconfigure(extension),
        });
      });
      return () => {
        cancelled = true;
        view.destroy();
        viewRef.current = null;
      };
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 仅在换文件时重建；内容变化由 CodeMirror 自己维护
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.path, props.readOnly]);

  // 主题跟随 html[data-theme]
  useEffect(() => {
    return observeThemeChange(() => {
      const view = viewRef.current;
      if (!view) return;
      view.dispatch({
        effects: themeCompartmentRef.current.reconfigure(currentEditorTheme()),
      });
    });
  }, []);

  // 跳转到指定行并高亮
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const line = props.highlightLine;
    if (!line || line < 1) {
      view.dispatch({ effects: setHighlightLine.of(null) });
      return;
    }
    const total = view.state.doc.lines;
    const target = Math.min(line, total);
    const info = view.state.doc.line(target);
    view.dispatch({
      selection: { anchor: info.from },
      effects: [
        setHighlightLine.of(target),
        EditorView.scrollIntoView(info.from, { y: "center" }),
      ],
    });
  }, [props.highlightLine, props.path]);

  // 暴露取内容 / 聚焦能力
  useEffect(() => {
    if (!props.handleRef) return;
    props.handleRef.current = {
      getValue: () => viewRef.current?.state.doc.toString() ?? props.value,
      focus: () => viewRef.current?.focus(),
    };
    return () => {
      if (props.handleRef) props.handleRef.current = null;
    };
  }, [props.handleRef, props.value]);

  return <div className="files-editor-host" ref={hostRef} />;
}
