import { describe, expect, it } from "vitest";

import {
  toPromptAttachments,
  useAttachmentsStore,
} from "./attachments-store";

describe("attachments-store", () => {
  it("dedupes attachments by relative path", () => {
    useAttachmentsStore.setState({ pending: {} });
    useAttachmentsStore.getState().add("session-1", [
      {
        path: "/tmp/a.png",
        name: "a.png",
        relativePath: ".pi-ling/attachments/a.png",
        mediaType: "image/png",
      },
      {
        path: "/tmp/a-copy.png",
        name: "a-copy.png",
        relativePath: ".pi-ling/attachments/a.png",
        mediaType: "image/png",
      },
    ]);
    expect(useAttachmentsStore.getState().pending["session-1"]).toHaveLength(1);
  });

  it("serializes pending attachments for send", () => {
    useAttachmentsStore.setState({ pending: {} });
    useAttachmentsStore.getState().add("session-2", [
      {
        path: "/tmp/b.png",
        name: "b.png",
        relativePath: ".pi-ling/attachments/b.png",
        mediaType: "image/png",
      },
    ]);
    const attachments = toPromptAttachments("session-2");
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.relativePath).toBe(".pi-ling/attachments/b.png");
  });
});
