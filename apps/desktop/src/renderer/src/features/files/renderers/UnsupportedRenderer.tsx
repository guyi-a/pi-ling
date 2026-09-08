import { workspaceDownloadURL } from "../../../lib/workspace-url";

export function UnsupportedRenderer(props: {
  root: string;
  path: string;
  name: string;
  size: number;
  reason: string;
}) {
  return (
    <div className="files-unsupported">
      <div className="files-unsupported-reason">{props.reason}</div>
      <div className="files-unsupported-meta">
        {props.name} · {formatSize(props.size)}
      </div>
      <a
        href={workspaceDownloadURL(props.root, props.path)}
        download={props.name}
        className="files-unsupported-download"
      >
        下载
      </a>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
