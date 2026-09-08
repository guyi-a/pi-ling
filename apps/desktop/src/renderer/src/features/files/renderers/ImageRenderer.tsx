import { workspaceDownloadURL } from "../../../lib/workspace-url";

export function ImageRenderer(props: {
  root: string;
  path: string;
  name: string;
}) {
  const src = workspaceDownloadURL(props.root, props.path);
  return (
    <div className="files-image">
      <img src={src} alt={props.name} />
    </div>
  );
}
