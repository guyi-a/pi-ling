import { workspaceInlineURL } from "../../../lib/workspace-url";

export function PdfPreview(props: {
  root: string;
  path: string;
  version?: number;
}) {
  const url = workspaceInlineURL(props.root, props.path, {
    ...(props.version !== undefined ? { version: props.version } : {}),
  });
  return (
    <div className="files-pdf">
      <iframe src={url} title={props.path} className="files-pdf-frame" />
    </div>
  );
}
