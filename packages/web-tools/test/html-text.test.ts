import { describe, expect, it } from "vitest";

import {
  decodeHtmlEntities,
  extractTextFromHtml,
  extractTitleFromHtml,
} from "../src/html-text.js";

describe("decodeHtmlEntities", () => {
  it("decodes named entities", () => {
    expect(decodeHtmlEntities("a &amp; b &lt;c&gt; &quot;d&quot;")).toBe(
      'a & b <c> "d"',
    );
  });

  it("decodes decimal and hex numeric entities", () => {
    expect(decodeHtmlEntities("&#65;&#x42;")).toBe("AB");
  });

  it("leaves unknown entities untouched", () => {
    expect(decodeHtmlEntities("&notarealentity; &")).toBe("&notarealentity; &");
  });
});

describe("extractTextFromHtml", () => {
  it("removes script, style, head and comments", () => {
    const html = `<!doctype html><html><head><title>T</title>
      <style>body{color:red}</style><script>alert(1)</script></head>
      <body><!-- hidden --><p>Visible</p></body></html>`;
    const text = extractTextFromHtml(html);
    expect(text).toContain("Visible");
    expect(text).not.toContain("alert");
    expect(text).not.toContain("color:red");
    expect(text).not.toContain("hidden");
  });

  it("separates paragraph-level blocks with a blank line", () => {
    const html = "<div><p>First</p><p>Second</p></div>";
    expect(extractTextFromHtml(html)).toBe("First\n\nSecond");
  });

  it("keeps list items on consecutive lines", () => {
    const html = "<ul><li>one</li><li>two</li><li>three</li></ul>";
    expect(extractTextFromHtml(html)).toBe("one\ntwo\nthree");
  });

  it("turns <br> into a single line break", () => {
    expect(extractTextFromHtml("<p>a<br>b</p>")).toBe("a\nb");
  });

  it("keeps preformatted code on separate lines", () => {
    const html =
      "<p>Install:</p><pre><code>npm install foo\nnpm run build</code></pre>";
    const text = extractTextFromHtml(html);
    expect(text).toContain("npm install foo\nnpm run build");
  });

  it("collapses inline whitespace but keeps paragraphs", () => {
    const html = "<p>a\n\n   b</p>\n\n\n\n<p>c</p>";
    expect(extractTextFromHtml(html)).toBe("a b\n\nc");
  });

  it("decodes entities inside text", () => {
    expect(extractTextFromHtml("<p>a &amp; b</p>")).toBe("a & b");
  });

  it("returns empty string for markup-only input", () => {
    expect(extractTextFromHtml("<div><span></span></div>")).toBe("");
  });
});

describe("extractTitleFromHtml", () => {
  it("extracts and cleans the title", () => {
    expect(extractTitleFromHtml("<title>  Hello &amp; World </title>")).toBe(
      "Hello & World",
    );
  });

  it("returns undefined when absent or empty", () => {
    expect(extractTitleFromHtml("<p>no title</p>")).toBeUndefined();
    expect(extractTitleFromHtml("<title>   </title>")).toBeUndefined();
  });
});
