import { describe, expect, it } from "vitest";

import { tagPlainCodeFenceOpenings } from "./normalize-plain-code-fences";

describe("tagPlainCodeFenceOpenings", () => {
  it("tags only opening fences without a language", () => {
    const input = "```\nline\n```";
    expect(tagPlainCodeFenceOpenings(input)).toBe("```text\nline\n```");
  });

  it("does not rewrite closing fences", () => {
    const input = "```\nline\n```\n\n**body**";
    expect(tagPlainCodeFenceOpenings(input)).toBe("```text\nline\n```\n\n**body**");
  });

  it("leaves labeled fences unchanged", () => {
    const input = "```ts\nconst ok = true\n```";
    expect(tagPlainCodeFenceOpenings(input)).toBe(input);
  });
});
