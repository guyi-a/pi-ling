import { pathToFileURL } from "node:url";

import { net, protocol } from "electron";

import {
  mimeForWorkspaceFile,
  resolveWorkspacePath,
} from "./workspace-fs.js";

export const WORKSPACE_PROTOCOL = "pi-ling";

export function registerWorkspaceProtocolSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: WORKSPACE_PROTOCOL,
      privileges: {
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        standard: true,
      },
    },
  ]);
}

export function registerWorkspaceProtocolHandlers(): void {
  protocol.handle(WORKSPACE_PROTOCOL, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.hostname !== "workspace") {
        return new Response("Not found", { status: 404 });
      }

      const mode = url.pathname.replace(/^\//, "");
      if (mode !== "inline" && mode !== "download") {
        return new Response("Not found", { status: 404 });
      }

      const root = url.searchParams.get("root");
      const subpath = url.searchParams.get("path");
      if (!root || !subpath) {
        return new Response("Bad request", { status: 400 });
      }

      const absolute = resolveWorkspacePath(root, subpath);
      const fileUrl = pathToFileURL(absolute).toString();
      const response = await net.fetch(fileUrl);
      const headers = new Headers(response.headers);
      headers.set("Content-Type", mimeForWorkspaceFile(subpath));
      if (mode === "download") {
        headers.set(
          "Content-Disposition",
          `attachment; filename="${encodeURIComponent(subpath.split("/").pop() ?? "file")}"`,
        );
      } else {
        headers.set("Content-Disposition", "inline");
      }
      return new Response(response.body, {
        status: response.status,
        headers,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Workspace protocol error";
      if (message.includes("escapes workspace")) {
        return new Response("Forbidden", { status: 403 });
      }
      return new Response(message, { status: 500 });
    }
  });
}
