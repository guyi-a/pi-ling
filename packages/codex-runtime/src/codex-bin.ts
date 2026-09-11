import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
  "x86_64-apple-darwin": "@openai/codex-darwin-x64",
  "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
  "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
  "aarch64-pc-windows-msvc": "@openai/codex-win32-arm64",
};

export function asarUnpackedPath(candidate: string): string {
  if (!candidate.includes("app.asar")) return candidate;
  if (candidate.includes("app.asar.unpacked")) return candidate;
  return candidate.replace("app.asar", "app.asar.unpacked");
}

/** Electron reports asar paths via existsSync, but native binaries must run from .unpacked. */
export function preferAsarUnpackedPath(candidate: string): string {
  const unpacked = asarUnpackedPath(candidate);
  return unpacked !== candidate && existsSync(unpacked) ? unpacked : candidate;
}

function targetTriple(): string | undefined {
  const { platform, arch } = process;
  if (platform === "linux" || platform === "android") {
    if (arch === "x64") return "x86_64-unknown-linux-musl";
    if (arch === "arm64") return "aarch64-unknown-linux-musl";
  }
  if (platform === "darwin") {
    if (arch === "x64") return "x86_64-apple-darwin";
    if (arch === "arm64") return "aarch64-apple-darwin";
  }
  if (platform === "win32") {
    if (arch === "x64") return "x86_64-pc-windows-msvc";
    if (arch === "arm64") return "aarch64-pc-windows-msvc";
  }
  return undefined;
}

/** Resolve the native Codex binary bundled with `@openai/codex` optional deps. */
export function resolveBundledCodexBin(): string | undefined {
  const triple = targetTriple();
  if (!triple) return undefined;
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[triple];
  if (!platformPackage) return undefined;

  try {
    const require = createRequire(import.meta.url);
    const codexRoot = dirname(require.resolve("@openai/codex/package.json"));
    const platformRoot = dirname(
      createRequire(codexRoot).resolve(`${platformPackage}/package.json`),
    );
    const binaryName = process.platform === "win32" ? "codex.exe" : "codex";
    const candidate = join(platformRoot, "vendor", triple, "bin", binaryName);
    if (!existsSync(candidate)) return undefined;
    return preferAsarUnpackedPath(candidate);
  } catch {
    return undefined;
  }
}
