import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type {
  WorkspaceFileContent,
  WorkspaceFileKind,
  WorkspaceTreeNode,
  WorkspaceTreeResult,
} from "@pi-ling/contracts";

const MAX_TREE_ENTRIES = 5000;
const MAX_FILE_BYTES = 512 * 1024;
const BINARY_SNIFF_LEN = 512;

function toPosix(relative: string): string {
  return relative.split(path.sep).join("/");
}

/** Resolve subpath inside workspace root; throws if path escapes root. */
export function resolveWorkspacePath(root: string, subpath: string): string {
  const base = path.resolve(root);
  const target =
    base === path.resolve(base, subpath) && subpath === ""
      ? base
      : path.resolve(base, subpath);
  const relative = path.relative(base, target);
  if (
    relative !== "" &&
    (relative.startsWith("..") || path.isAbsolute(relative))
  ) {
    throw new Error("Path escapes workspace root");
  }
  return target;
}

function shouldPruneWorkspaceTreeDir(name: string): boolean {
  switch (name) {
    case "node_modules":
    case "vendor":
    case "dist":
    case "build":
    case "out":
    case "target":
    case "coverage":
    case "package-resources":
    case "__pycache__":
      return true;
    default:
      return false;
  }
}

function shouldSkipHiddenEntry(name: string, isDir: boolean): boolean {
  if (!name.startsWith(".")) return false;
  if (isDir) return true;
  if (name === ".env" || name.startsWith(".env.")) return false;
  return true;
}

function classifyFileName(name: string): WorkspaceFileKind {
  if (name === ".env" || name.startsWith(".env.")) return "text";
  return classifyExt(path.extname(name).toLowerCase());
}

function classifyExt(ext: string): WorkspaceFileKind {
  switch (ext) {
    case ".md":
    case ".markdown":
      return "markdown";
    case ".txt":
    case ".log":
    case ".json":
    case ".yaml":
    case ".yml":
    case ".csv":
    case ".go":
    case ".py":
    case ".js":
    case ".ts":
    case ".jsx":
    case ".tsx":
    case ".sh":
    case ".html":
    case ".css":
    case ".xml":
    case ".toml":
    case ".ini":
    case ".env":
    case ".mod":
    case ".sum":
      return "text";
    case ".png":
    case ".jpg":
    case ".jpeg":
    case ".gif":
    case ".webp":
    case ".svg":
    case ".bmp":
      return "image";
    case "":
      return "text";
    default:
      return "unsupported";
  }
}

function isBinaryContent(sniff: Buffer): boolean {
  for (let index = 0; index < sniff.length; index += 1) {
    if (sniff[index] === 0) return true;
  }
  return false;
}

export async function buildWorkspaceTree(
  root: string,
): Promise<WorkspaceTreeResult> {
  const base = path.resolve(root);
  const entries: WorkspaceTreeNode[] = [];
  let truncated = false;

  async function walk(dir: string): Promise<void> {
    if (truncated) return;
    let dirents;
    try {
      dirents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (truncated) return;
      const name = dirent.name;
      const isDir = dirent.isDirectory();
      if (shouldSkipHiddenEntry(name, isDir)) {
        if (isDir) continue;
        continue;
      }
      if (isDir && shouldPruneWorkspaceTreeDir(name)) {
        continue;
      }
      const abs = path.join(dir, name);
      const relative = toPosix(path.relative(base, abs));
      const entry: WorkspaceTreeNode = {
        name,
        path: isDir ? `${relative}/` : relative,
        kind: isDir ? "dir" : "file",
      };
      if (!isDir) {
        try {
          const stats = await stat(abs);
          entry.size = stats.size;
        } catch {
          // ignore concurrent deletes
        }
      }
      entries.push(entry);
      if (entries.length >= MAX_TREE_ENTRIES) {
        truncated = true;
        return;
      }
      if (isDir) await walk(abs);
    }
  }

  await walk(base);

  entries.sort((a, b) => {
    const depthA = (a.path.match(/\//g) ?? []).length;
    const depthB = (b.path.match(/\//g) ?? []).length;
    if (depthA !== depthB) return depthA - depthB;
    return a.path.localeCompare(b.path);
  });

  const result: WorkspaceTreeResult = {
    workspaceRootName: path.basename(base),
    entries,
  };
  if (truncated) result.truncated = true;
  return result;
}

export async function readFileContent(
  root: string,
  subpath: string,
): Promise<WorkspaceFileContent> {
  let target: string;
  try {
    target = resolveWorkspacePath(root, subpath);
  } catch (error) {
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const name = path.basename(target);

  try {
    const stats = await stat(target);
    if (!stats.isFile()) {
      return { kind: "error", message: "Not a file" };
    }

    const classified = classifyFileName(name);
    if (classified === "image") {
      return { kind: "image", path: subpath, name, size: stats.size };
    }
    if (classified === "unsupported") {
      return { kind: "unsupported", path: subpath, name, size: stats.size };
    }

    const handle = await readFile(target);
    const sniff = handle.subarray(0, Math.min(BINARY_SNIFF_LEN, handle.length));
    if (isBinaryContent(sniff)) {
      return { kind: "binary", path: subpath, name, size: stats.size };
    }

    const readLen = Math.min(handle.length, MAX_FILE_BYTES);
    const content = handle.subarray(0, readLen).toString("utf8");
    const truncated = stats.size > readLen;
    const kind =
      classified === "markdown" && !truncated
        ? "markdown"
        : classified === "markdown"
          ? "text"
          : classified;

    if (kind === "markdown") {
      return {
        kind: "markdown",
        path: subpath,
        name,
        content,
        size: stats.size,
        ...(truncated ? { truncated: true } : {}),
      };
    }

    return {
      kind: "text",
      path: subpath,
      name,
      content,
      size: stats.size,
      ...(truncated ? { truncated: true } : {}),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" };
    }
    return {
      kind: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".aac": "audio/aac",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

export function mimeForWorkspaceFile(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
