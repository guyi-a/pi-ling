import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveWorkspacePath } from "./workspace-fs.js";

export const MAX_ATTACHMENT_IMAGE_BYTES = 4 * 1024 * 1024;
const ATTACHMENTS_SUBDIR = path.join(".pi-ling", "attachments");

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
]);

export interface SavedAttachmentImage {
  path: string;
  name: string;
  relativePath: string;
  mediaType: string;
}

export function extFromMime(mime: string): string {
  switch (mime) {
    case "image/png":
      return ".png";
    case "image/jpeg":
      return ".jpg";
    case "image/webp":
      return ".webp";
    case "image/gif":
      return ".gif";
    case "image/bmp":
      return ".bmp";
    default:
      return ".png";
  }
}

export function mimeFromExtension(ext: string): string | undefined {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".bmp":
      return "image/bmp";
    default:
      return undefined;
  }
}

export function isImageFilename(name: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase());
}

function attachmentsDir(workspaceRoot: string): string {
  return path.join(workspaceRoot, ATTACHMENTS_SUBDIR);
}

function toRelativePath(workspaceRoot: string, absolute: string): string {
  return path.relative(workspaceRoot, absolute).split(path.sep).join("/");
}

function assertWithinWorkspace(workspaceRoot: string, absolute: string): void {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(absolute);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Attachment path escapes workspace");
  }
}

export async function saveAttachmentImage(options: {
  workspaceRoot: string;
  bytes: Buffer;
  mimeType: string;
  suggestedName?: string;
}): Promise<SavedAttachmentImage> {
  if (!options.mimeType.startsWith("image/")) {
    throw new Error("Only image attachments are supported");
  }
  if (options.bytes.length > MAX_ATTACHMENT_IMAGE_BYTES) {
    throw new Error(
      `Image exceeds ${MAX_ATTACHMENT_IMAGE_BYTES} bytes`,
    );
  }

  const dir = attachmentsDir(options.workspaceRoot);
  await mkdir(dir, { recursive: true });

  const suggested = (options.suggestedName ?? "").trim();
  const safeSuggested = suggested
    ? path.basename(suggested).replace(/[/\\]/g, "_")
    : "";
  const ext = safeSuggested
    ? path.extname(safeSuggested).toLowerCase() || extFromMime(options.mimeType)
    : extFromMime(options.mimeType);
  if (!IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(`Unsupported image type: ${ext}`);
  }
  const stem = safeSuggested
    ? path.basename(safeSuggested, path.extname(safeSuggested)) || "pasted"
    : "pasted";
  const name = `${stem}-${randomUUID().slice(0, 8)}${ext}`;
  const absolute = path.join(dir, name);
  assertWithinWorkspace(options.workspaceRoot, absolute);
  await writeFile(absolute, options.bytes);

  return {
    path: absolute,
    name,
    relativePath: toRelativePath(options.workspaceRoot, absolute),
    mediaType: mimeFromExtension(ext) ?? options.mimeType,
  };
}

export async function importAttachmentImageFromPath(options: {
  workspaceRoot: string;
  sourcePath: string;
}): Promise<SavedAttachmentImage> {
  const sourceAbsolute = path.resolve(options.sourcePath);
  if (!isImageFilename(sourceAbsolute)) {
    throw new Error("Selected file is not a supported image");
  }
  const bytes = await readFile(sourceAbsolute);
  const ext = path.extname(sourceAbsolute).toLowerCase();
  const mimeType = mimeFromExtension(ext);
  if (!mimeType) {
    throw new Error(`Unsupported image type: ${ext}`);
  }
  return saveAttachmentImage({
    workspaceRoot: options.workspaceRoot,
    bytes,
    mimeType,
    suggestedName: path.basename(sourceAbsolute),
  });
}
