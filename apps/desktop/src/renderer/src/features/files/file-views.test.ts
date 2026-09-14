import { describe, expect, it } from "vitest";

import { hasSourceView, pickFileView, resolveFileViews } from "./file-views";

describe("resolveFileViews", () => {
  it("offers preview and source for markdown", () => {
    expect(resolveFileViews({ kind: "markdown", path: "a.md" })).toEqual([
      "preview",
      "source",
    ]);
  });

  it("offers preview and source for csv/tsv", () => {
    expect(resolveFileViews({ kind: "text", path: "data.csv" })).toEqual([
      "preview",
      "source",
    ]);
    expect(resolveFileViews({ kind: "text", path: "data.tsv" })).toEqual([
      "preview",
      "source",
    ]);
  });

  it("offers only source for other text files", () => {
    expect(resolveFileViews({ kind: "text", path: "a.ts" })).toEqual(["source"]);
    expect(resolveFileViews({ kind: "text", path: "README" })).toEqual(["source"]);
  });

  it("offers no toggle for non-text content", () => {
    for (const kind of ["image", "binary", "unsupported"] as const) {
      expect(resolveFileViews({ kind, path: "a.bin" }), kind).toEqual([]);
    }
  });
});

describe("hasSourceView", () => {
  it("reports whether source is available", () => {
    expect(hasSourceView(["preview", "source"])).toBe(true);
    expect(hasSourceView(["source"])).toBe(true);
    expect(hasSourceView(["preview"])).toBe(false);
    expect(hasSourceView([])).toBe(false);
  });
});

describe("pickFileView", () => {
  it("honours the remembered preference when supported", () => {
    expect(pickFileView(["preview", "source"], "source")).toBe("source");
    expect(pickFileView(["preview", "source"], "preview")).toBe("preview");
  });

  it("falls back to the first available view when the preference is unsupported", () => {
    // 上次在 markdown 里选了 source，这次打开的是纯文本（只支持 source）
    expect(pickFileView(["source"], "preview")).toBe("source");
    // 反过来：偏好 source，但该类型只有 preview
    expect(pickFileView(["preview"], "source")).toBe("preview");
  });

  it("defaults to the first view when nothing is remembered", () => {
    expect(pickFileView(["preview", "source"], null)).toBe("preview");
    expect(pickFileView(["source"], undefined)).toBe("source");
  });

  it("returns undefined when there are no views", () => {
    expect(pickFileView([], "source")).toBeUndefined();
  });
});
