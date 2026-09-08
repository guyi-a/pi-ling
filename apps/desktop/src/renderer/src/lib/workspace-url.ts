const WORKSPACE_PROTOCOL = "pi-ling";

function buildWorkspaceResourceUrl(
  mode: "inline" | "download",
  root: string,
  subpath: string,
  version?: number,
): string {
  const params = new URLSearchParams({
    root,
    path: subpath,
  });
  if (version !== undefined) {
    params.set("v", String(version));
  }
  return `${WORKSPACE_PROTOCOL}://workspace/${mode}?${params.toString()}`;
}

export function workspaceInlineURL(
  root: string,
  subpath: string,
  options?: { version?: number },
): string {
  return buildWorkspaceResourceUrl("inline", root, subpath, options?.version);
}

export function workspaceDownloadURL(root: string, subpath: string): string {
  return buildWorkspaceResourceUrl("download", root, subpath);
}
