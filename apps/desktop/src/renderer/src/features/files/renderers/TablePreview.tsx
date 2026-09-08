import { useMemo } from "react";

const MAX_ROWS = 500;
const MAX_COLS = 50;

export function isTablePath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".csv") || lower.endsWith(".tsv");
}

function parse(text: string, sep: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return {
      headers: [] as string[],
      rows: [] as string[][],
      tooManyRows: false,
      tooManyCols: false,
    };
  }
  const rawHeaders = lines[0]!.split(sep);
  const tooManyCols = rawHeaders.length > MAX_COLS;
  const headers = rawHeaders.slice(0, MAX_COLS);
  const tooManyRows = lines.length - 1 > MAX_ROWS;
  const rows = lines
    .slice(1, MAX_ROWS + 1)
    .map((line) => line.split(sep).slice(0, MAX_COLS));
  return { headers, rows, tooManyRows, tooManyCols };
}

export function TablePreview(props: { content: string; path: string }) {
  const sep = props.path.toLowerCase().endsWith(".tsv") ? "\t" : ",";
  const { headers, rows, tooManyRows, tooManyCols } = useMemo(
    () => parse(props.content, sep),
    [props.content, sep],
  );

  return (
    <div className="files-table-wrap">
      <table className="files-table">
        <thead>
          <tr>
            <th className="files-table-corner" />
            {headers.map((header, index) => (
              <th key={index}>{header || `col_${index + 1}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <td className="files-table-num">{rowIndex + 1}</td>
              {headers.map((_, colIndex) => (
                <td key={colIndex} title={row[colIndex] ?? ""}>
                  {row[colIndex] ?? ""}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {tooManyRows || tooManyCols ? (
        <div className="files-table-note">
          {tooManyRows ? `已截断到前 ${MAX_ROWS} 行` : ""}
          {tooManyRows && tooManyCols ? " · " : ""}
          {tooManyCols ? `已截断到前 ${MAX_COLS} 列` : ""}
          {" · "}复杂 CSV（含引号转义/多行 cell）建议下载查看
        </div>
      ) : null}
    </div>
  );
}
