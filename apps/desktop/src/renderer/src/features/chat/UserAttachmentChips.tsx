import type { TimelineUserAttachment } from "@pi-ling/contracts";

import { workspaceDownloadURL } from "../../lib/workspace-url";
import { useFilesStore } from "../files/store";

export function UserAttachmentChips(props: {
  attachments: TimelineUserAttachment[];
  workspaceRoot?: string;
}) {
  if (props.attachments.length === 0) return null;
  const openFile = useFilesStore((state) => state.openFile);
  return (
    <div className="user-attachment-chips" aria-label="消息图片">
      {props.attachments.map((attachment) => {
        const src = props.workspaceRoot
          ? workspaceDownloadURL(props.workspaceRoot, attachment.relativePath)
          : undefined;
        return (
          <button
            key={attachment.relativePath}
            type="button"
            className="user-attachment-chip"
            title={attachment.name}
            onClick={() => openFile(attachment.relativePath)}
          >
            {src ? (
              <img
                className="user-attachment-chip-thumb"
                src={src}
                alt={attachment.name}
              />
            ) : null}
            <span className="user-attachment-chip-name">{attachment.name}</span>
          </button>
        );
      })}
    </div>
  );
}
