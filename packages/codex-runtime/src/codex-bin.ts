import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

function resolveBundledCodexBinFromAnchor(
  anchor: string,
  triple: string,
  platformPackage: string,
): string | undefined {
  try {
    const require = createRequire(anchor);
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

function bundledCodexBinAnchors(
  searchRoots: readonly string[] = [],
): string[] {
  const anchors = new Set<string>();
  anchors.add(fileURLToPath(import.meta.url));
  for (const root of searchRoots) {
    anchors.add(join(root, "packages", "codex-runtime", "package.json"));
    anchors.add(join(root, "node_modules", "@pi-ling", "codex-runtime", "package.json"));
  }
  anchors.add(
    join(process.cwd(), "node_modules", "@pi-ling", "codex-runtime", "package.json"),
  );
  return [...anchors].filter((anchor) => existsSync(anchor));
}

export interface ResolveBundledCodexBinOptions {
  /** Repo or app roots used when the caller is bundled outside codex-runtime. */
  searchRoots?: readonly string[];
}

/** Resolve the native Codex binary bundled with `@openai/codex` optional deps. */
export function resolveBundledCodexBin(
  options: ResolveBundledCodexBinOptions = {},
): string | undefined {
  const triple = targetTriple();
  if (!triple) return undefined;
  const platformPackage = PLATFORM_PACKAGE_BY_TARGET[triple];
  if (!platformPackage) return undefined;

  for (const anchor of bundledCodexBinAnchors(options.searchRoots)) {
    const candidate = resolveBundledCodexBinFromAnchor(
      anchor,
      triple,
      platformPackage,
    );
    if (candidate) return candidate;
  }
  return undefined;
}
