import type { ChangedFile, FileDiff } from "@pi-ling/contracts";
import { useState } from "react";

export function DiffPanel(props: {
  files: ChangedFile[];
  loadDiff: (path: string) => Promise<FileDiff | undefined>;
}) {
  const [selected, setSelected] = useState<FileDiff | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  async function select(file: ChangedFile) {
    const diff = await props.loadDiff(file.path);
    setSelected(diff ?? null);
    setUnavailable(diff ? null : file.path);
  }

  return (
    <aside className="diff-panel">
      <p className="section-label">CHANGES</p>
      {props.files.length === 0 ? (
        <div className="empty-changes">No changes</div>
      ) : (
        props.files.map((file) => (
          <button
            className="change-file"
            type="button"
            key={file.path}
            onClick={() => select(file)}
          >
            <span>{file.path}</span>
            <small>{file.status}</small>
          </button>
        ))
      )}
      {selected ? (
        <pre className="diff-content">{selected.patch}</pre>
      ) : unavailable ? (
        <div className="diff-unavailable">
          Diff unavailable for {unavailable}
        </div>
      ) : null}
    </aside>
  );
}
