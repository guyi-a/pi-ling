import type { ChangedFile } from "@pi-ling/contracts";

function basename(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

function fileBadge(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "·";
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext.length <= 4) return ext.toUpperCase();
  return ext.slice(0, 3).toUpperCase();
}

export function TurnChangesCard(props: {
  files: ChangedFile[];
  onReview: () => void;
}) {
  if (props.files.length === 0) return null;

  const count = props.files.length;
  const label = `${count} ${count === 1 ? "File" : "Files"} Changed`;

  return (
    <section className="turn-changes-card" aria-label={label}>
      <div className="turn-changes-header">
        <span className="turn-changes-title">{label}</span>
        <button
          type="button"
          className="turn-changes-review"
          onClick={props.onReview}
        >
          Review
        </button>
      </div>
      <ul className="turn-changes-list">
        {props.files.map((file) => {
          const name = basename(file.path);
          return (
            <li className="turn-changes-row" key={file.path}>
              <button
                type="button"
                className="turn-changes-file"
                onClick={props.onReview}
                title={file.path}
              >
                <span className="turn-changes-badge">{fileBadge(name)}</span>
                <span className="turn-changes-name">{name}</span>
                <span className="turn-changes-stats">
                  {file.additions ? (
                    <span className="diff-add">+{file.additions}</span>
                  ) : null}
                  {file.deletions ? (
                    <span className="diff-delete">-{file.deletions}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
