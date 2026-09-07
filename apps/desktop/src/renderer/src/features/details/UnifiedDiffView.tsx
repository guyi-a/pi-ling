import { memo, useState } from "react";

export type DiffLineKind = "add" | "delete" | "context" | "hunk" | "meta";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldLine?: number | undefined;
  newLine?: number | undefined;
}

const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/;
const SKIP_RE = /^(diff --git |index |--- |\+\+\+ |new file mode |deleted file mode |similarity index |rename from |rename to |Binary files |old mode |new mode )/;

export function parseUnifiedDiff(patch: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine: number | undefined;
  let newLine: number | undefined;
  for (const raw of patch.split(/\r?\n/)) {
    if (raw === "") continue;
    const text = raw;
    const hunk = HUNK_RE.exec(text);
    if (hunk) {
      const oldStart = Number(hunk[1]!);
      const newStart = Number(hunk[2]!);
      oldLine = oldStart;
      newLine = newStart;
      const context = (hunk[3] ?? "").trim();
      lines.push({
        kind: "hunk",
        text: context
          ? `@@ -${hunk[1]} +${hunk[2]} @@ ${context}`
          : text,
      });
      continue;
    }
    if (text.startsWith("+") && !text.startsWith("+++")) {
      const line = newLine;
      if (newLine !== undefined) newLine += 1;
      lines.push({ kind: "add", text: text.slice(1), newLine: line });
      continue;
    }
    if (text.startsWith("-") && !text.startsWith("---")) {
      const line = oldLine;
      if (oldLine !== undefined) oldLine += 1;
      lines.push({ kind: "delete", text: text.slice(1), oldLine: line });
      continue;
    }
    if (text.startsWith(" ")) {
      const before = oldLine;
      const after = newLine;
      if (oldLine !== undefined) oldLine += 1;
      if (newLine !== undefined) newLine += 1;
      lines.push({
        kind: "context",
        text: text.slice(1),
        oldLine: before,
        newLine: after,
      });
      continue;
    }
    if (SKIP_RE.test(text)) {
      // 文件头元信息（diff --git/index/---/+++ 等）直接跳过，不渲染。
      continue;
    }
    lines.push({ kind: "meta", text });
  }
  return lines;
}

export interface DiffStats {
  additions: number;
  deletions: number;
}

export function diffStats(patch: string): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions += 1;
    if (line.startsWith("-") && !line.startsWith("---")) deletions += 1;
  }
  return { additions, deletions };
}

export type RenderLine = DiffLine | { kind: "collapsed"; count: number };

export const COLLAPSE_THRESHOLD = 10;

export function collapseContext(
  lines: DiffLine[],
  threshold: number,
): RenderLine[] {
  const output: RenderLine[] = [];
  let contextRun = 0;
  let collapseStart = 0;
  for (let index = 0; index <= lines.length; index += 1) {
    const line: DiffLine | undefined = lines[index];
    const isContext = line?.kind === "context";
    if (isContext) {
      contextRun += 1;
      if (contextRun === 1) collapseStart = index;
      continue;
    }
    if (contextRun > 0) {
      if (contextRun > threshold) {
        output.push({ kind: "collapsed", count: contextRun });
      } else {
        for (let cursor = collapseStart; cursor < index; cursor += 1) {
          const contextLine = lines[cursor];
          if (contextLine) output.push(contextLine);
        }
      }
      contextRun = 0;
    }
    if (line) output.push(line);
  }
  return output;
}

export const UnifiedDiffView = memo(function UnifiedDiffView(props: {
  patch: string;
  truncated?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = parseUnifiedDiff(props.patch);
  const rendered = collapseContext(
    lines,
    expanded ? Infinity : COLLAPSE_THRESHOLD,
  );

  return (
    <div className="unified-diff">
      <div className="diff-lines">
        {rendered.map((line, index) => {
          if ("kind" in line && line.kind === "collapsed") {
            return (
              <button
                className="diff-collapsed"
                type="button"
                key={`collapsed:${index}`}
                onClick={() => setExpanded((current) => !current)}
              >
                <span className="diff-collapsed-count" />
                <span className="diff-collapsed-label">
                  {line.count} unmodified lines
                </span>
              </button>
            );
          }
          return (
            <div
              className={`diff-line diff-${line.kind}`}
              key={`${index}:${line.kind}`}
            >
              <span className="diff-gutter diff-gutter-old">
                {line.kind === "delete" ? line.oldLine ?? "" : ""}
              </span>
              <span className="diff-gutter diff-gutter-new">
                {line.kind === "add" ? line.newLine ?? "" : ""}
              </span>
              <span className="diff-sign">
                {line.kind === "add"
                  ? "+"
                  : line.kind === "delete"
                    ? "-"
                    : ""}
              </span>
              <span className="diff-line-content">
                {line.text || " "}
              </span>
            </div>
          );
        })}
      </div>
      {props.truncated ? (
        <div className="diff-truncated">Diff 内容过长，已截断</div>
      ) : null}
    </div>
  );
});

