import { promises as fs } from "node:fs";
import { glob as fsGlob } from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  "target",
  "vendor",
  "__pycache__",
]);

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
};

/** 单个文本文件的大小上限；超过则不读取（grep 与 readText 共用）。 */
const MAX_TEXT_FILE_BYTES = 512 * 1024;

/**
 * grep 的并发批大小。
 *
 * 逐文件串行读取时，几乎全部时间花在 syscall 往返上（实测 1671 个文件
 * 约 500ms，其中读 22MB 只占极小部分），因此并发收益接近线性。
 * 批内并行、批间按顺序收集，保证结果顺序与串行版一致。
 */
const GREP_READ_BATCH = 32;

export interface WorkspaceEntry {
  path: string;
  type: "file" | "directory";
  size?: number;
}

export class Workspace {
  readonly root: string;
  readonly #realRoot: string;

  private constructor(root: string, realRoot: string) {
    this.root = root;
    this.#realRoot = realRoot;
  }

  static async open(root: string): Promise<Workspace> {
    const absolute = path.resolve(root);
    const stats = await fs.stat(absolute);
    if (!stats.isDirectory()) {
      throw new Error("Workspace root must be a directory");
    }
    return new Workspace(absolute, await fs.realpath(absolute));
  }

  async resolve(userPath: string): Promise<string> {
    if (path.isAbsolute(userPath)) {
      throw new Error("Absolute paths are not allowed");
    }
    const absolute = path.resolve(this.root, userPath || ".");
    this.#assertInside(absolute);

    const existing = await this.#nearestExisting(absolute);
    const realExisting = await fs.realpath(existing);
    this.#assertRealInside(realExisting);
    return absolute;
  }

  relative(absolute: string): string {
    this.#assertInside(absolute);
    const relative = path.relative(this.root, absolute);
    return relative === "" ? "." : relative.split(path.sep).join("/");
  }

  async readText(userPath: string, maxBytes = MAX_TEXT_FILE_BYTES): Promise<string> {
    const absolute = await this.resolve(userPath);
    const stats = await fs.stat(absolute);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${userPath}`);
    }
    if (stats.size > maxBytes) {
      throw new Error(`File exceeds ${maxBytes} bytes: ${userPath}`);
    }
    const content = await fs.readFile(absolute);
    if (content.subarray(0, 8192).includes(0)) {
      throw new Error(`Binary file is not supported: ${userPath}`);
    }
    return content.toString("utf8");
  }

  async writeText(userPath: string, content: string): Promise<void> {
    const absolute = await this.resolve(userPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, "utf8");
  }

  async list(
    userPath = ".",
    recursive = false,
    maxEntries = 5000,
  ): Promise<WorkspaceEntry[]> {
    const start = await this.resolve(userPath);
    const output: WorkspaceEntry[] = [];
    await this.#walk(start, recursive, maxEntries, output);
    return output;
  }

  async grep(
    pattern: string,
    userPath = ".",
    maxEntries = 5000,
    maxMatches = 200,
  ): Promise<Array<{ path: string; line: number; text: string }>> {
    const expression = new RegExp(pattern, "i");
    const files = (await this.list(userPath, true, maxEntries)).filter(
      (entry) =>
        entry.type === "file" && (entry.size ?? 0) <= MAX_TEXT_FILE_BYTES,
    );
    const matches: Array<{ path: string; line: number; text: string }> = [];

    for (
      let offset = 0;
      offset < files.length && matches.length < maxMatches;
      offset += GREP_READ_BATCH
    ) {
      const batch = files.slice(offset, offset + GREP_READ_BATCH);
      const contents = await Promise.all(
        batch.map((file) => this.#readForGrep(file.path)),
      );

      // 按批内顺序收集，保持与串行实现相同的「先文件序、后行序」
      for (let index = 0; index < batch.length; index += 1) {
        const content = contents[index];
        if (content === undefined) continue;
        for (const [lineIndex, line] of content.split(/\r?\n/).entries()) {
          if (!expression.test(line)) continue;
          matches.push({
            path: batch[index]!.path,
            line: lineIndex + 1,
            text: line,
          });
          if (matches.length >= maxMatches) break;
        }
        if (matches.length >= maxMatches) break;
      }
    }

    return matches;
  }

  /**
   * grep 专用读取快路径。
   *
   * 路径来自 `#walk`，而 `#walk` 会跳过符号链接，因此这些路径必定是
   * 工作区内的真实文件 —— 不必再走 `resolve()` 的 `realpath` 校验
   * （那是每次 grep 最主要的额外 syscall 开销）。
   * 只保留与 `readText` 一致的大小与二进制内容检查。
   */
  async #readForGrep(relativePath: string): Promise<string | undefined> {
    try {
      const content = await fs.readFile(path.join(this.root, relativePath));
      if (content.length > MAX_TEXT_FILE_BYTES) return undefined;
      if (content.subarray(0, 8192).includes(0)) return undefined;
      return content.toString("utf8");
    } catch {
      return undefined;
    }
  }

  async glob(
    pattern: string,
    userPath = ".",
    maxResults = 500,
  ): Promise<string[]> {
    const start = await this.resolve(userPath);
    const stats = await fs.stat(start);
    const cwd = stats.isDirectory() ? start : path.dirname(start);
    const matches = fsGlob(pattern, { cwd });
    const output: string[] = [];
    for await (const match of matches) {
      if (output.length >= maxResults) break;
      const absolute = path.resolve(cwd, String(match));
      const entryStats = await fs.stat(absolute);
      if (!entryStats.isFile()) continue;
      this.#assertInside(absolute);
      const real = await fs.realpath(absolute);
      this.#assertRealInside(real);
      output.push(this.relative(absolute));
    }
    return output.sort((left, right) => left.localeCompare(right));
  }

  async deleteFile(userPath: string): Promise<void> {
    const absolute = await this.resolve(userPath);
    const stats = await fs.stat(absolute);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${userPath}`);
    }
    await fs.unlink(absolute);
  }

  async readImage(
    userPath: string,
    maxBytes = 4 * 1024 * 1024,
  ): Promise<{ data: string; mimeType: string; size: number }> {
    const absolute = await this.resolve(userPath);
    const stats = await fs.stat(absolute);
    if (!stats.isFile()) {
      throw new Error(`Not a file: ${userPath}`);
    }
    if (stats.size > maxBytes) {
      throw new Error(`Image exceeds ${maxBytes} bytes: ${userPath}`);
    }
    const mimeType = IMAGE_MIME_TYPES[path.extname(absolute).toLowerCase()];
    if (!mimeType) {
      throw new Error(`Unsupported image type: ${userPath}`);
    }
    const bytes = await fs.readFile(absolute);
    return {
      data: bytes.toString("base64"),
      mimeType,
      size: stats.size,
    };
  }

  async #walk(
    directory: string,
    recursive: boolean,
    maxEntries: number,
    output: WorkspaceEntry[],
  ): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });

    // 第一遍：只并发 stat 本目录下的文件，拿到 size。
    // 单独 stat 是为了 size —— grep 依赖它过滤超大文件（构建产物里
    // 有数百 MB 的 app.asar），所以不能省。
    const filePaths: string[] = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink() || !entry.isFile()) continue;
      filePaths.push(path.join(directory, entry.name));
    }
    const sizes = new Map<string, number>();
    const stats = await Promise.all(
      filePaths.map(async (absolute) => {
        try {
          return (await fs.stat(absolute)).size;
        } catch {
          return undefined;
        }
      }),
    );
    for (let index = 0; index < filePaths.length; index += 1) {
      const size = stats[index];
      if (size !== undefined) sizes.set(filePaths[index]!, size);
    }

    // 第二遍：严格按 readdir 顺序输出，与串行实现完全一致。
    for (const entry of entries) {
      if (output.length >= maxEntries) {
        return;
      }
      if (entry.isSymbolicLink()) {
        continue;
      }
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        output.push({ path: this.relative(absolute), type: "directory" });
        if (recursive && !IGNORED_DIRECTORIES.has(entry.name)) {
          await this.#walk(absolute, true, maxEntries, output);
        }
      } else if (entry.isFile()) {
        const size = sizes.get(absolute);
        if (size === undefined) continue;
        output.push({
          path: this.relative(absolute),
          type: "file",
          size,
        });
      }
    }
  }

  async #nearestExisting(absolute: string): Promise<string> {
    let current = absolute;
    while (true) {
      try {
        await fs.lstat(current);
        return current;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          throw error;
        }
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error("Could not resolve workspace path");
      }
      current = parent;
    }
  }

  #assertInside(absolute: string): void {
    const relative = path.relative(this.root, absolute);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("Path is outside the workspace");
    }
  }

  #assertRealInside(realPath: string): void {
    const relative = path.relative(this.#realRoot, realPath);
    if (
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("Path resolves outside the workspace");
    }
  }
}
