import { describe, expect, it } from "vitest";

import { externalHrefFromClickTarget, isExternalLinkHref } from "./external-link";

describe("isExternalLinkHref", () => {
  it("allows http and https", () => {
    expect(isExternalLinkHref("https://electron-vite.org/guide/")).toBe(true);
    expect(isExternalLinkHref("http://example.com")).toBe(true);
    expect(isExternalLinkHref("  https://example.com  ")).toBe(true);
  });

  it("rejects other protocols", () => {
    for (const href of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "mailto:a@b.com",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox",
      "chrome://settings",
    ]) {
      expect(isExternalLinkHref(href), href).toBe(false);
    }
  });

  it("rejects relative and empty hrefs", () => {
    expect(isExternalLinkHref("/docs/readme")).toBe(false);
    expect(isExternalLinkHref("#section")).toBe(false);
    expect(isExternalLinkHref("")).toBe(false);
    expect(isExternalLinkHref("   ")).toBe(false);
  });
});

describe("externalHrefFromClickTarget", () => {
  it("returns null for non-element targets", () => {
    expect(externalHrefFromClickTarget(null)).toBeNull();
    expect(externalHrefFromClickTarget("text")).toBeNull();
  });
});
