import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  PINNED_DSH_VERSION,
  resolveDshLaunchConfig,
} from "./dsh-launch-config.js";

const directories: string[] = [];

async function installation(version = PINNED_DSH_VERSION) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pi-ling-dsh-config-"));
  directories.push(root);
  const cliRoot = path.join(root, "apps", "cli");
  const bin = path.join(cliRoot, "lib", "bin.js");
  await fs.mkdir(path.dirname(bin), { recursive: true });
  await fs.writeFile(bin, "");
  await fs.writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ version }),
  );
  await fs.writeFile(
    path.join(cliRoot, "package.json"),
    JSON.stringify({ version }),
  );
  return { root, bin };
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("resolveDshLaunchConfig", () => {
  it("keeps DSH disabled unless explicitly enabled", () => {
    expect(resolveDshLaunchConfig({}, "/user-data")).toEqual({
      enabled: false,
    });
  });

  it("fails closed when an enabled DSH path is missing", () => {
    expect(
      resolveDshLaunchConfig(
        { PI_LING_DSH_ENABLED: "true" },
        "/user-data",
      ),
    ).toMatchObject({
      enabled: true,
      reason: expect.stringMatching(/PI_LING_DSH_BIN|dsh:setup/),
    });
  });

  it("auto-detects DSH from .dsh-source when repo root is known", async () => {
    const { root, bin } = await installation();
    const repoRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "pi-ling-dsh-repo-"),
    );
    directories.push(repoRoot);
    await fs.symlink(
      root,
      path.join(repoRoot, ".dsh-source"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const result = resolveDshLaunchConfig(
      { PI_LING_DSH_ENABLED: "true" },
      "/user-data",
      process.execPath,
      repoRoot,
    );
    expect(result).toMatchObject({
      enabled: true,
      sourceRoot: root,
    });
    if (!("options" in result)) {
      throw new Error(`expected DSH options: ${result.reason}`);
    }
    expect(result.options.dshBin).toContain(".dsh-source");
    expect(result.options.dshBin.endsWith("bin.js")).toBe(true);
  });

  it("rejects an installation with the wrong version", async () => {
    const { bin } = await installation("0.1.0-rc.5");
    expect(
      resolveDshLaunchConfig(
        {
          PI_LING_DSH_ENABLED: "true",
          PI_LING_DSH_BIN: bin,
        },
        "/user-data",
      ),
    ).toMatchObject({
      enabled: true,
      reason: expect.stringContaining("version mismatch"),
    });
  });

  it("resolves the pinned installation without platform defaults", async () => {
    const { root, bin } = await installation();
    const result = resolveDshLaunchConfig(
      {
        PI_LING_DSH_ENABLED: "true",
        PI_LING_DSH_BIN: bin,
        DEEPSEEK_API_KEY: "secret",
        ANTHROPIC_API_KEY: "anthropic-secret",
        DEEPSEEK_BASE_URL: "https://deepseek.test",
        ANTHROPIC_BASE_URL: "https://anthropic.test",
      },
      "/user-data",
    );
    expect(result).toMatchObject({
      enabled: true,
      sourceRoot: root,
      options: {
        dshBin: bin,
        command: process.execPath,
        cwd: root,
        profilePatch: expect.stringContaining(
          "@deepseek-ai/dsh-llm-pi-ai",
        ),
        env: {
          DEEPSEEK_API_KEY: "secret",
          ANTHROPIC_API_KEY: "anthropic-secret",
          DEEPSEEK_BASE_URL: "https://deepseek.test",
          ANTHROPIC_BASE_URL: "https://anthropic.test",
        },
      },
    });
  });

  it("prefers a real Node binary from PATH over Electron", async () => {
    const { bin } = await installation();
    const result = resolveDshLaunchConfig(
      {
        PI_LING_DSH_ENABLED: "true",
        PI_LING_DSH_BIN: bin,
      },
      "/user-data",
      "C:/Apps/pi-ling.exe",
    );
    expect(result).toMatchObject({ enabled: true });
    if (!("options" in result)) {
      throw new Error(`expected DSH options: ${result.reason}`);
    }
    expect(result.options.command.endsWith("node.exe")).toBe(
      process.platform === "win32",
    );
    expect(result.options.command).not.toBe("C:/Apps/pi-ling.exe");
  });
});
