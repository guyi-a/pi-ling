import { readFileSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveCodexLaunchConfig } from "./codex-launch-config.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("resolveCodexLaunchConfig", () => {
  it("stays disabled without feature flag", () => {
    expect(resolveCodexLaunchConfig({}, "/tmp/user")).toEqual({
      enabled: false,
    });
  });

  it("materializes DeepSeek config when enabled", async () => {
    const userData = await fs.mkdtemp(
      path.join(os.tmpdir(), "pi-ling-codex-launch-"),
    );
    directories.push(userData);
    const resolution = resolveCodexLaunchConfig(
      {
        PI_LING_CODEX_ENABLED: "true",
        DEEPSEEK_API_KEY: "test-key",
      },
      userData,
    );
    expect(resolution).toMatchObject({ enabled: true });
    if (!("options" in resolution)) {
      expect(resolution.reason).toMatch(
        /Codex binary not found|executable does not exist/,
      );
      return;
    }
    expect(
      readFileSync(
        path.join(resolution.options.codexHome, "config.toml"),
        "utf8",
      ),
    ).toContain('model = "deepseek-v4-flash"');
    expect(
      JSON.parse(
        readFileSync(
          path.join(resolution.options.codexHome, "models.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      models: [expect.objectContaining({ slug: "deepseek-v4-flash" })],
    });
  });
});
