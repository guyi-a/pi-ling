import { workspaceDownloadURL, workspaceInlineURL } from "../../../lib/workspace-url";

export function MediaPreview(props: {
  root: string;
  path: string;
  name: string;
  kind: "video" | "audio";
  version?: number;
}) {
  const src = workspaceInlineURL(props.root, props.path, {
    ...(props.version !== undefined ? { version: props.version } : {}),
  });
  const downloadHref = workspaceDownloadURL(props.root, props.path);

  return (
    <div className="files-media">
      {props.kind === "video" ? (
        <video
          src={src}
          controls
          preload="metadata"
          className="files-media-player files-media-player--video"
        />
      ) : (
        <audio
          src={src}
          controls
          preload="metadata"
          className="files-media-player"
        />
      )}
      <a href={downloadHref} download={props.name} className="files-media-download">
        浏览器无法播放？下载文件
      </a>
    </div>
  );
}
