import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  importAttachmentImageFromPath,
  MAX_ATTACHMENT_IMAGE_BYTES,
  saveAttachmentImage,
} from "./attachment-store.js";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z5BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

describe("attachment-store", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function tempWorkspace(): Promise<string> {
    const root = await mkdtemp(path.join(os.tmpdir(), "pi-ling-attach-"));
    roots.push(root);
    return root;
  }

  it("saves pasted images under workspace/.pi-ling/attachments", async () => {
    const workspaceRoot = await tempWorkspace();
    const saved = await saveAttachmentImage({
      workspaceRoot,
      bytes: PNG_BYTES,
      mimeType: "image/png",
      suggestedName: "shot.png",
    });

    expect(saved.relativePath).toMatch(/^\.pi-ling\/attachments\//);
    expect(saved.mediaType).toBe("image/png");
    const onDisk = await readFile(saved.path);
    expect(onDisk.equals(PNG_BYTES)).toBe(true);
  });

  it("rejects images larger than the cap", async () => {
    const workspaceRoot = await tempWorkspace();
    await expect(
      saveAttachmentImage({
        workspaceRoot,
        bytes: Buffer.alloc(MAX_ATTACHMENT_IMAGE_BYTES + 1),
        mimeType: "image/png",
      }),
    ).rejects.toThrow(/exceeds/);
  });

  it("imports picked image files into the workspace attachments dir", async () => {
    const workspaceRoot = await tempWorkspace();
    const source = path.join(workspaceRoot, "source.png");
    await import("node:fs/promises").then((fs) => fs.writeFile(source, PNG_BYTES));
    const saved = await importAttachmentImageFromPath({
      workspaceRoot,
      sourcePath: source,
    });
    expect(saved.relativePath).toContain(".pi-ling/attachments/");
    expect(saved.name).toMatch(/source-/);
  });
});
