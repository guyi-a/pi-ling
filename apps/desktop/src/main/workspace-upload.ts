import { randomUUID } from "node:crypto";
import { access, copyFile, stat } from "node:fs/promises";
import path from "node:path";

export const MAX_WORKSPACE_UPLOAD_BYTES = 50 * 1024 * 1024;

export interface WorkspaceUploadedFile {
  name: string;
  relativePath: string;
  size: number;
}

function toRelativePath(workspaceRoot: string, absolute: string): string {
  return path.relative(workspaceRoot, absolute).split(path.sep).join("/");
}

function assertWithinWorkspace(workspaceRoot: string, absolute: string): void {
  const resolvedRoot = path.resolve(workspaceRoot);
  const resolved = path.resolve(absolute);
  const relative = path.relative(resolvedRoot, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Upload path escapes workspace");
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function uniqueDestinationPath(
  workspaceRoot: string,
  preferredName: string,
): Promise<string> {
  const safeName = path.basename(preferredName).replace(/[/\\]/g, "_");
  const ext = path.extname(safeName);
  const stem = path.basename(safeName, ext) || "file";
  let candidate = path.join(workspaceRoot, safeName);
  assertWithinWorkspace(workspaceRoot, candidate);
  if (!(await pathExists(candidate))) {
    return candidate;
  }
  candidate = path.join(
    workspaceRoot,
    `${stem}-${randomUUID().slice(0, 8)}${ext}`,
  );
  assertWithinWorkspace(workspaceRoot, candidate);
  return candidate;
}

async function importFileToWorkspaceRoot(
  workspaceRoot: string,
  sourcePath: string,
): Promise<WorkspaceUploadedFile> {
  const sourceAbsolute = path.resolve(sourcePath);
  const sourceStat = await stat(sourceAbsolute);
  if (!sourceStat.isFile()) {
    throw new Error("Only files can be uploaded");
  }
  if (sourceStat.size > MAX_WORKSPACE_UPLOAD_BYTES) {
    throw new Error(
      `File exceeds ${MAX_WORKSPACE_UPLOAD_BYTES} bytes`,
    );
  }

  const destination = await uniqueDestinationPath(
    workspaceRoot,
    path.basename(sourceAbsolute),
  );
  await copyFile(sourceAbsolute, destination);
  const savedStat = await stat(destination);
  return {
    name: path.basename(destination),
    relativePath: toRelativePath(workspaceRoot, destination),
    size: savedStat.size,
  };
}

export async function importFilesToWorkspaceRoot(options: {
  workspaceRoot: string;
  sourcePaths: string[];
}): Promise<WorkspaceUploadedFile[]> {
  const workspaceRoot = path.resolve(options.workspaceRoot);
  const saved: WorkspaceUploadedFile[] = [];
  for (const sourcePath of options.sourcePaths) {
    saved.push(await importFileToWorkspaceRoot(workspaceRoot, sourcePath));
  }
  return saved;
}
