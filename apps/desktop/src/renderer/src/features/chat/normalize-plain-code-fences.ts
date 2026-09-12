const CODE_FENCE_PATTERN = /^(`{3,})([^\n`]*?)\s*$/;

/** Tag only opening plain fences; never rewrite closing ``` lines. */
export function tagPlainCodeFenceOpenings(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  let inFence = false;

  return lines
    .map((line) => {
      const match = CODE_FENCE_PATTERN.exec(line);
      if (!match) return line;

      const ticks = match[1];
      const info = match[2]?.trim() ?? "";

      if (!inFence) {
        inFence = true;
        return info ? line : `${ticks}text`;
      }

      inFence = false;
      return line;
    })
    .join("\n");
}
