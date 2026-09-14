import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type {
  WorkspaceFileContent,
  WorkspaceFileKind,
  WorkspaceMutationResult,
  WorkspaceTreeNode,
  WorkspaceTreeResult,
  WorkspaceWriteResult,
} from "@pi-ling/contracts";

const MAX_TREE_ENTRIES = 20_000;
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

/** 单次编辑允许写入的最大字节数，防止误写超大数据把界面卡死。 */
const MAX_WRITE_BYTES = 4 * 1024 * 1024;

/**
 * 写入工作区内的 UTF-8 文本文件。
 *
 * 与 `readFileContent` 对称：路径一律经 `resolveWorkspacePath` 校验，
 * 越界或不可写时返回 `{ ok: false }` 而不抛异常 —— 调用方是 UI，
 * 需要把失败原因展示出来而不是让 IPC 直接 reject。
 */
export async function writeFileContent(
  root: string,
  subpath: string,
  content: string,
): Promise<WorkspaceWriteResult> {
  let target: string;
  try {
    target = resolveWorkspacePath(root, subpath);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }

  const size = Buffer.byteLength(content, "utf8");
  if (size > MAX_WRITE_BYTES) {
    return {
      ok: false,
      message: `文件超过 ${Math.round(MAX_WRITE_BYTES / 1024 / 1024)} MB，已拒绝写入`,
    };
  }

  try {
    const stats = await stat(target);
    if (stats.isDirectory()) {
      return { ok: false, message: "目标是目录，无法写入" };
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      return {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    // 文件不存在：允许创建，但父目录必须已存在，避免手滑写出意外路径。
    try {
      await stat(path.dirname(target));
    } catch {
      return { ok: false, message: "父目录不存在" };
    }
  }

  try {
    await writeFile(target, content, "utf8");
    return { ok: true, size };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * 读取用于 diff 的工作区侧文本。
 *
 * 与 `readFileContent` 的区别：不做类型分类、不返回 union，只关心
 * 「能不能拿到纯文本」。二进制或超限返回 `undefined`，调用方回退到 patch。
 */
export async function readTextForDiff(
  root: string,
  subpath: string,
): Promise<string | undefined> {
  let target: string;
  try {
    target = resolveWorkspacePath(root, subpath);
  } catch {
    return undefined;
  }
  try {
    const stats = await stat(target);
    if (!stats.isFile() || stats.size > MAX_DIFF_TEXT_BYTES) return undefined;
    const handle = await readFile(target);
    if (isBinaryContent(handle.subarray(0, BINARY_SNIFF_LEN))) return undefined;
    return handle.toString("utf8");
  } catch {
    // 文件不存在（删除场景）由调用方按空串处理
    return undefined;
  }
}

/** diff 双侧内容的大小上限；超过则不做高亮渲染，回退 patch。 */
export const MAX_DIFF_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * 校验单段名称是否可用作文件/目录名。
 *
 * 除了空值与路径分隔符，还要挡住 Windows 的保留字符与保留设备名 ——
 * 在 Windows 上建一个叫 `nul` 的文件会静默失败或以诡异方式成功。
 */
function validateEntryName(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return "名称不能为空";
  if (trimmed === "." || trimmed === "..") return "名称无效";
  if (/[/\\]/.test(trimmed)) return "名称不能包含路径分隔符";
  // eslint-disable-next-line no-control-regex
  if (/[<>:"|?*\u0000-\u001f]/.test(trimmed)) return "名称包含非法字符";
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(trimmed)) {
    return "名称是系统保留名";
  }
  // 尾部句点必须拒绝：Windows 创建文件时会静默去掉它，导致"建了却找不到"
  if (trimmed.endsWith(".")) return "名称不能以点结尾";
  return undefined;
}

/** 把失败原因统一成 `{ ok: false }`，调用方是 UI，不需要异常。 */
function fail(error: unknown): WorkspaceMutationResult {
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * 在工作区内新建文件或目录。
 *
 * `parent` 是相对工作区的目录路径（可带可不带结尾 "/"），`name` 是单段名称。
 * 已存在同名项时返回失败而非覆盖 —— 走 `wx` / 非递归 `mkdir` 的原子语义，
 * 避免"先查后写"之间的竞态把用户已有文件清空。
 */
export async function createWorkspaceEntry(
  root: string,
  parent: string,
  name: string,
  kind: "file" | "dir",
): Promise<WorkspaceMutationResult> {
  const nameError = validateEntryName(name);
  if (nameError) return { ok: false, message: nameError };
  const trimmedName = name.trim();

  const parentSubpath = parent.trim().replace(/\/+$/, "");
  let parentDir: string;
  let target: string;
  try {
    parentDir =
      parentSubpath === ""
        ? path.resolve(root)
        : resolveWorkspacePath(root, parentSubpath);
    target = path.join(parentDir, trimmedName);
    // 复用同一套越界校验：确保拼出来的目标仍在工作区内
    resolveWorkspacePath(root, path.relative(path.resolve(root), target));
  } catch (error) {
    return fail(error);
  }

  try {
    const stats = await stat(parentDir);
    if (!stats.isDirectory()) return { ok: false, message: "父路径不是目录" };
  } catch {
    return { ok: false, message: "父目录不存在" };
  }

  const isDir = kind === "dir";
  try {
    if (isDir) {
      // 非递归 mkdir：目录已存在时会抛 EEXIST，正好当作"重名"处理
      await mkdir(target);
    } else {
      // wx：已存在则失败，绝不覆盖
      await writeFile(target, "", { encoding: "utf8", flag: "wx" });
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return { ok: false, message: `已存在同名${isDir ? "目录" : "文件"}` };
    }
    return fail(error);
  }
  return { ok: true };
}

/**
 * 删除工作区内的文件或目录（目录递归）。
 *
 * 两道保护：拒绝删除工作区根目录，拒绝删除顶层 `.git`。两者都不可恢复
 * （`.git` 没了等于丢掉整个仓库历史），宁可让用户去终端手动做。
 */
export async function deleteWorkspaceEntry(
  root: string,
  subpath: string,
): Promise<WorkspaceMutationResult> {
  const trimmed = subpath.trim().replace(/\/+$/, "");
  if (!trimmed) return { ok: false, message: "不能删除工作区根目录" };
  if (trimmed === ".git" || trimmed.startsWith(".git/")) {
    return { ok: false, message: "拒绝删除 .git 目录" };
  }

  let target: string;
  try {
    target = resolveWorkspacePath(root, trimmed);
  } catch (error) {
    return fail(error);
  }
  if (target === path.resolve(root)) {
    return { ok: false, message: "不能删除工作区根目录" };
  }

  try {
    await rm(target, { recursive: true, force: true });
  } catch (error) {
    return fail(error);
  }
  return { ok: true };
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
