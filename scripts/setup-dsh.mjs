import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  symlinkSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_TAG = "dsh-v0.1.3-alpha.1";
const EXPECTED_COMMIT = "d347e703908d0406b7a7ef80e3a0e594d86b2215";
const EXPECTED_VERSION = "0.1.3-alpha.1";
const EXPECTED_ACP_SDK = "1.4.0";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRepo = resolve(
  process.env["PI_LING_DSH_REPO"] ??
    resolve(projectRoot, "..", "deepseek-harness"),
);
const worktree = resolve(
  process.env["PI_LING_DSH_WORKTREE"] ??
    resolve(projectRoot, "..", "deepseek-harness-d347e703"),
);
const sourceAlias = resolve(projectRoot, ".dsh-source");
const verifyOnly = process.argv.includes("--verify");

function runGit(args, cwd = sourceRepo) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function requireSupportedNode() {
  const [major, minor] = process.versions.node
    .split(".")
    .map((value) => Number(value));
  if (
    !Number.isInteger(major) ||
    !Number.isInteger(minor) ||
    !((major === 22 && minor >= 19) || major >= 24)
  ) {
    throw new Error(
      `DSH ${EXPECTED_VERSION} requires Node ^22.19.0 or >=24.0.0; current Node is ${process.versions.node}`,
    );
  }
}

function readManifest(relativePath) {
  const manifestPath = resolve(worktree, relativePath);
  if (!existsSync(manifestPath)) {
    throw new Error(`Missing DSH manifest: ${manifestPath}`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf8"));
}

function ensurePinnedCommitAvailable() {
  try {
    runGit(["cat-file", "-e", `${EXPECTED_COMMIT}^{commit}`]);
  } catch {
    if (verifyOnly) {
      throw new Error(
        `Pinned DSH commit ${EXPECTED_COMMIT} is not available locally; run pnpm dsh:setup`,
      );
    }
    execFileSync(
      "git",
      ["-C", sourceRepo, "fetch", "origin", "tag", EXPECTED_TAG],
      { stdio: "inherit" },
    );
  }
  const tagCommit = runGit(["rev-list", "-n", "1", EXPECTED_TAG]);
  if (tagCommit !== EXPECTED_COMMIT) {
    throw new Error(
      `DSH tag ${EXPECTED_TAG} resolves to ${tagCommit}, expected ${EXPECTED_COMMIT}`,
    );
  }
}

function ensureWorktree() {
  if (!existsSync(worktree)) {
    if (verifyOnly) {
      throw new Error(
        `Pinned DSH worktree is missing: ${worktree}; run pnpm dsh:setup`,
      );
    }
    execFileSync(
      "git",
      [
        "-C",
        sourceRepo,
        "worktree",
        "add",
        "--detach",
        worktree,
        EXPECTED_COMMIT,
      ],
      { stdio: "inherit" },
    );
  }
  const actualCommit = runGit(["rev-parse", "HEAD"], worktree);
  if (actualCommit !== EXPECTED_COMMIT) {
    throw new Error(
      `DSH worktree ${worktree} is at ${actualCommit}, expected ${EXPECTED_COMMIT}`,
    );
  }
}

function ensureSourceAlias() {
  if (existsSync(sourceAlias)) {
    const stat = lstatSync(sourceAlias);
    if (!stat.isSymbolicLink()) {
      throw new Error(
        `${sourceAlias} exists but is not a symlink/junction; remove it manually`,
      );
    }
    if (realpathSync(sourceAlias) !== realpathSync(worktree)) {
      throw new Error(
        `${sourceAlias} points to ${realpathSync(sourceAlias)}, expected ${worktree}`,
      );
    }
    return;
  }
  if (verifyOnly) {
    throw new Error(
      `DSH source alias is missing: ${sourceAlias}; run pnpm dsh:setup`,
    );
  }
  symlinkSync(worktree, sourceAlias, process.platform === "win32" ? "junction" : "dir");
}

function verifyManifests() {
  const root = readManifest("package.json");
  const cli = readManifest("apps/cli/package.json");
  const acp = readManifest("packages/acp/acp/package.json");
  const acpSdk =
    acp.dependencies?.["@agentclientprotocol/sdk"] ??
    acp.devDependencies?.["@agentclientprotocol/sdk"];
  for (const [name, version] of [
    ["DSH root", root.version],
    ["DSH CLI", cli.version],
    ["DSH ACP", acp.version],
  ]) {
    if (version !== EXPECTED_VERSION) {
      throw new Error(
        `${name} version is ${String(version)}, expected ${EXPECTED_VERSION}`,
      );
    }
  }
  if (acpSdk !== EXPECTED_ACP_SDK) {
    throw new Error(
      `DSH ACP SDK version is ${String(acpSdk)}, expected ${EXPECTED_ACP_SDK}`,
    );
  }
}

function main() {
  requireSupportedNode();
  if (!existsSync(resolve(sourceRepo, ".git"))) {
    throw new Error(
      `DSH source repository is missing: ${sourceRepo}. Set PI_LING_DSH_REPO to the existing clone.`,
    );
  }
  ensurePinnedCommitAvailable();
  ensureWorktree();
  ensureSourceAlias();
  verifyManifests();
  console.log(`DSH tag: ${EXPECTED_TAG}`);
  console.log(`DSH commit: ${EXPECTED_COMMIT}`);
  console.log(`DSH version: ${EXPECTED_VERSION}`);
  console.log(`ACP SDK: ${EXPECTED_ACP_SDK}`);
  console.log(`Node: ${process.versions.node}`);
  console.log(`Worktree: ${worktree}`);
  console.log(`Source alias: ${sourceAlias}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
