import type { TimelineUserAttachment } from "@pi-ling/contracts";

import { workspaceInlineURL } from "../../lib/workspace-url";
import { useFilesStore } from "../files/store";

export function UserAttachmentChips(props: {
  attachments: TimelineUserAttachment[];
  workspaceRoot?: string;
}) {
  if (props.attachments.length === 0) return null;
  const requestOpenFile = useFilesStore((state) => state.requestOpenFile);
  return (
    <div className="user-attachment-chips" aria-label="消息图片">
      {props.attachments.map((attachment) => {
        const src = props.workspaceRoot
          ? workspaceInlineURL(props.workspaceRoot, attachment.relativePath)
          : undefined;
        return (
          <button
            key={attachment.relativePath}
            type="button"
            className="user-attachment-chip"
            aria-label={`预览 ${attachment.name}`}
            title={attachment.name}
            onClick={() => requestOpenFile(attachment.relativePath)}
          >
            {src ? (
              <img
                className="user-attachment-chip-thumb"
                src={src}
                alt=""
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
