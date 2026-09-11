import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { writeDeepSeekCodexHome } from "../src/codex-deepseek-config.js";

describe("writeDeepSeekCodexHome", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes Windows sandbox backend on win32", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    const home = mkdtempSync(join(tmpdir(), "pi-ling-codex-home-"));
    writeDeepSeekCodexHome(home);
    const config = readFileSync(join(home, "config.toml"), "utf8");
    expect(config).toContain("[windows]");
    expect(config).toContain('sandbox = "unelevated"');
  });

  it("omits Windows sandbox backend on non-Windows platforms", () => {
    vi.stubGlobal("process", { ...process, platform: "linux" });
    const home = mkdtempSync(join(tmpdir(), "pi-ling-codex-home-"));
    writeDeepSeekCodexHome(home);
    const config = readFileSync(join(home, "config.toml"), "utf8");
    expect(config).not.toContain("[windows]");
  });
});
