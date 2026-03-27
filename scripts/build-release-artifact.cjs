#!/usr/bin/env node
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { SUPPORTED_CODEX_VERSIONS, artifactPlatformKey } = require("../lib/patcher");

const WORK_ROOT = path.join(os.homedir(), ".slopex");
const SOURCE_ROOT = path.join(WORK_ROOT, "codex-src");
const ARTIFACT_ROOT = path.join(WORK_ROOT, "artifacts");
const BUILD_PROFILE = "ci-test";
const CHILD_ENV = createChildEnv();

const CODEX_SUPPORT = {
  "0.117.0": {
    tag: "rust-v0.117.0",
    patchFile: path.join(__dirname, "..", "patches", "rust-v0.117.0.patch")
  }
};

const codexVersion = SUPPORTED_CODEX_VERSIONS[0];
if (!codexVersion) {
  throw new Error("No supported Codex versions are configured.");
}

const support = CODEX_SUPPORT[codexVersion];
if (!support) {
  throw new Error(`No build recipe is configured for Codex ${codexVersion}.`);
}

ensureBuildPrerequisites();
ensurePatchFileExists(support.patchFile);

const repoDir = ensureSourceCheckout(support.tag);
applyPatchIfNeeded(repoDir, support.patchFile);
buildPatchedCodex(repoDir);

const builtBinary = path.join(repoDir, "codex-rs", "target", BUILD_PROFILE, "codex");
if (!fs.existsSync(builtBinary)) {
  throw new Error(`Expected built binary at ${builtBinary}, but it was not found.`);
}

const artifactBinary = path.join(
  ARTIFACT_ROOT,
  codexVersion,
  artifactPlatformKey(),
  executableName("codex")
);
ensureDir(path.dirname(artifactBinary));
fs.copyFileSync(builtBinary, artifactBinary);
fs.chmodSync(artifactBinary, 0o755);

console.log(`built slopex artifact: ${artifactBinary}`);

function ensureBuildPrerequisites() {
  ensureCommand("git", ["--version"], "Install git before building a slopex release artifact.");
  ensureCommand(
    "cargo",
    ["--version"],
    "Install Rust and Cargo before building a slopex release artifact: https://rustup.rs"
  );
  ensureCommand(
    "rustup",
    ["--version"],
    "Install rustup before building a slopex release artifact."
  );
  ensureCommand(
    "pkg-config",
    ["--version"],
    "Install pkg-config before building a slopex release artifact."
  );

  if (process.platform === "linux") {
    const libcap = spawnSync("pkg-config", ["--exists", "libcap"], { stdio: "ignore" });
    if (libcap.status !== 0) {
      throw new Error(
        "Linux builds require libcap development headers. Install them first, for example: apt-get install -y libcap-dev"
      );
    }
  }
}

function ensurePatchFileExists(patchFile) {
  if (!fs.existsSync(patchFile)) {
    throw new Error(`Missing slopex patch file: ${patchFile}`);
  }
}

function ensureSourceCheckout(tag) {
  ensureDir(SOURCE_ROOT);
  const repoDir = path.join(SOURCE_ROOT, tag);
  if (!fs.existsSync(repoDir)) {
    runInherited("git", [
      "clone",
      "--branch",
      tag,
      "--depth",
      "1",
      "https://github.com/openai/codex.git",
      repoDir
    ]);
    return repoDir;
  }

  const describe = runChecked("git", ["-C", repoDir, "describe", "--tags", "--exact-match"], {
    allowFailure: true
  });
  if (describe.status !== 0 || describe.stdout.trim() !== tag) {
    fs.rmSync(repoDir, { recursive: true, force: true });
    return ensureSourceCheckout(tag);
  }
  return repoDir;
}

function applyPatchIfNeeded(repoDir, patchFile) {
  const applyCheck = runChecked("git", ["-C", repoDir, "apply", "--check", patchFile], {
    allowFailure: true
  });
  if (applyCheck.status === 0) {
    runInherited("git", ["-C", repoDir, "apply", patchFile]);
    return;
  }

  const reverseCheck = runChecked(
    "git",
    ["-C", repoDir, "apply", "-R", "--check", patchFile],
    { allowFailure: true }
  );
  if (reverseCheck.status === 0) {
    console.log("slopex patch already applied in cached source checkout");
    return;
  }

  throw new Error(`Unable to apply slopex patch cleanly in ${repoDir}. Delete ${repoDir} and try again.`);
}

function buildPatchedCodex(repoDir) {
  runInherited(
    "cargo",
    ["build", "--profile", BUILD_PROFILE, "-p", "codex-cli", "--bin", "codex"],
    { cwd: path.join(repoDir, "codex-rs") }
  );
}

function executableName(baseName) {
  return process.platform === "win32" ? `${baseName}.exe` : baseName;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function createChildEnv() {
  const cargoBin = path.join(os.homedir(), ".cargo", "bin");
  const pathEntries = (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean);
  if (!pathEntries.includes(cargoBin)) {
    pathEntries.unshift(cargoBin);
  }
  return {
    ...process.env,
    PATH: pathEntries.join(path.delimiter)
  };
}

function ensureCommand(command, args, failureMessage) {
  const result = spawnSync(command, args, {
    env: CHILD_ENV,
    stdio: "ignore"
  });
  if (result.error || result.status !== 0) {
    throw new Error(failureMessage);
  }
}

function runInherited(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...CHILD_ENV,
      ...(options.env || {})
    },
    stdio: "inherit"
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
  }
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...CHILD_ENV,
      ...(options.env || {})
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });
  if (result.error && !options.allowFailure) {
    throw result.error;
  }
  if (!options.allowFailure && result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    throw new Error(
      `${command} ${args.join(" ")} failed with exit code ${result.status}${stderr ? `\n${stderr}` : ""}`
    );
  }
  return result;
}
