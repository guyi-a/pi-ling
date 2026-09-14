import {
  assembleExcerpt,
  MARKER_SENTINEL,
  type ExcerptSegment,
} from "./selection-context";

/**
 * 把选中范围序列化成引用正文，并**把列表序号补回来**。
 *
 * ## 为什么要手工重建
 *
 * 列表序号与项目符号是 CSS `::marker` 生成的伪元素，**不在 DOM 里**，
 * 因此既不被高亮、也不会出现在 `selection.toString()` 里。实测确认：
 *
 *   li.textContent       = "brainstorming —— …"     （不含序号）
 *   ol.childNodes        = [TEXT("\n"), LI, …]       （无序号文本节点）
 *   selection.toString() = "brainstorming —— …"     （不含 "1."）
 *
 * 对「1. 2. 3.」这类步骤清单，丢序号等于丢语义，所以这里遍历文本节点自己拼。
 *
 * ## 两个必须踩对的细节（都实测过）
 *
 * 1. **锚点要用哨兵字符，不能记偏移**：Streamdown 的 `ul` 会输出
 *    `<li>\n<p>文字</p>\n</li>` —— 每个 li 内部先有一个**纯空白文本节点**。
 *    按「第一次遇到该 li 的文本」记偏移会把序号插进空白中间；而且后续做空白
 *    规整会把偏移全部打乱。用哨兵字符写入正文，规整时它天然把前面的空白压掉，
 *    序号自动落到行首。
 * 2. **空白要按上下文分别处理**：`ul` 的原生文本是
 *    `"\n\n无序项甲\n\n\n无序项乙…"`（一串空行），而 `ol` 是干净的单换行。
 *    列表内做规整、代码块逐字符保留，否则代码缩进会被破坏。
 */
export function collectSelectionExcerpt(range: Range): string {
  const root = range.commonAncestorContainer;
  /*
   * 遍历起点不能直接用 commonAncestorContainer：当整个选区落在**同一个文本节点
   * 内部**时（例如只选一句话里的几个词），它本身就是 Text 节点，而
   * `createTreeWalker(textNode).nextNode()` 永远不会返回根节点（文本节点没有
   * 子节点），遍历结果为空 —— 摘录会变成空字符串。实测踩过。
   * 往上一层作为起点，再靠 range.intersectsNode 过滤即可。
   */
  const walkRoot =
    root.nodeType === Node.TEXT_NODE ? (root.parentNode ?? root) : root;
  const doc = root.ownerDocument ?? document;
  const walker = doc.createTreeWalker(walkRoot, NodeFilter.SHOW_TEXT);

  const segments: ExcerptSegment[] = [];
  const markers: string[] = [];
  /** 已经补过序号的 li，避免同一项内多个文本节点重复插入。 */
  const numberedLists = new Set<Element>();

  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    if (range.intersectsNode(text)) {
      let piece = clipTextToRange(text, range);
      if (piece) {
        const element = text.parentElement;
        const inPre = element?.closest("pre") != null;
        // 序号锚点必须落在 li 上
        const li = inPre ? null : (element?.closest("li") ?? null);
        /*
         * 空白规整的范围要按「任何列表元素内」判定，不能只看 li：
         * li 之间的空白文本节点属于 `<ul>`（closest('li') 为 null），
         * 若把它当成普通正文，整段列表会被切成多块，跨节点的空白串就漏规整了
         * —— 表现为引用里仍是一串空行。
         */
        const inList = element?.closest("li, ul, ol") != null;

        // 只锚定在**有实际内容**的文本上，并且锚在该内容之前
        if (li && !numberedLists.has(li)) {
          const lead = piece.length - piece.trimStart().length;
          if (piece.trim()) {
            numberedLists.add(li);
            const marker = markerForListItem(li);
            if (marker) {
              markers.push(marker);
              piece = `${piece.slice(0, lead)}${MARKER_SENTINEL}${piece.slice(lead)}`;
            }
          }
        }

        segments.push({
          text: piece,
          kind: inPre ? "pre" : inList ? "list" : "text",
        });
      }
    }
    node = walker.nextNode();
  }

  return assembleExcerpt(segments, markers);
}

/**
 * 取文本节点落在选区内的那一段。
 *
 * 只有当节点本身就是选区的起止容器时才需要裁剪；其余情况整个节点都在范围内。
 */
function clipTextToRange(text: Text, range: Range): string {
  const start = text === range.startContainer ? range.startOffset : 0;
  const end = text === range.endContainer ? range.endOffset : text.length;
  if (start >= end) return "";
  return text.data.slice(start, end);
}

/**
 * 为列表项生成标记文本；`undefined` 表示该项本来就不显示标记。
 *
 * `ul` 用 `-` 而不是 `•`：引用是给模型读的，Markdown 风格的项目符号更自然。
 * 嵌套层级用两空格缩进还原，否则多级清单会挤成同一层。
 */
function markerForListItem(li: HTMLLIElement): string | undefined {
  const parent = li.parentElement;
  if (!parent) return undefined;

  // 尊重项目自己的 list-style: none（本仓库多处显式关掉了标记）
  const listStyle = getComputedStyle(parent).listStyleType;
  if (listStyle === "none") return undefined;

  const indent = "  ".repeat(Math.max(0, listDepth(li) - 1));
  const tag = parent.tagName.toLowerCase();

  if (tag === "ol") {
    return `${indent}${ordinalOf(li, parent)}.`;
  }
  if (tag === "ul") {
    return `${indent}-`;
  }
  return undefined;
}

/** li 在其所属 ol 里的序号，兼顾 `ol[start]` 与 `li[value]`。 */
function ordinalOf(li: HTMLLIElement, ol: Element): number {
  // li.value 未设置时浏览器给 0，此时按 start + 兄弟下标推算
  if (li.value > 0) return li.value;
  const start = Number(ol.getAttribute("start") ?? "1");
  const siblings = Array.from(ol.children).filter(
    (child) => child.tagName === "LI",
  );
  const index = siblings.indexOf(li);
  const base = Number.isFinite(start) ? start : 1;
  return base + Math.max(0, index);
}

/** li 的嵌套深度（1 表示最外层列表）。 */
function listDepth(li: HTMLLIElement): number {
  let depth = 0;
  let current: Element | null = li.parentElement;
  while (current) {
    const tag = current.tagName.toLowerCase();
    if (tag === "ul" || tag === "ol") depth += 1;
    current = current.parentElement;
  }
  return Math.max(depth, 1);
}
