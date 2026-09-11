import { describe, expect, it } from "vitest";

import {
  asarUnpackedPath,
  resolveBundledCodexBin,
} from "../src/codex-bin.js";

describe("asarUnpackedPath", () => {
  it("remaps app.asar native binary paths to app.asar.unpacked", () => {
    expect(
      asarUnpackedPath(
        "C:/app/resources/app.asar/node_modules/@openai/codex-win32-x64/vendor/x/bin/codex.exe",
      ),
    ).toBe(
      "C:/app/resources/app.asar.unpacked/node_modules/@openai/codex-win32-x64/vendor/x/bin/codex.exe",
    );
    expect(
      asarUnpackedPath(
        "C:/app/resources/app.asar.unpacked/node_modules/codex.exe",
      ),
    ).toBe("C:/app/resources/app.asar.unpacked/node_modules/codex.exe");
  });
});

describe("resolveBundledCodexBin", () => {
  it("resolves the native binary installed with @openai/codex", () => {
    const bin = resolveBundledCodexBin();
    if (process.env["CI"] === "true" && !bin) {
      return;
    }
    expect(bin).toEqual(expect.stringMatching(/codex(\.exe)?$/));
  });
});
