const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { spawnSync } = require("node:child_process");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const PACKAGE_JSON = require(path.join(PACKAGE_ROOT, "package.json"));
const WORK_ROOT = path.join(os.homedir(), ".slopex");
const SOURCE_ROOT = path.join(WORK_ROOT, "codex-src");
const BACKUP_ROOT = path.join(WORK_ROOT, "backups");
const ARTIFACT_ROOT = path.join(WORK_ROOT, "artifacts");
const BUNDLED_ARTIFACT_ROOT = path.join(PACKAGE_ROOT, "artifacts");
const INSTALL_STATE_PATH = path.join(WORK_ROOT, "install-state.json");
const CONFIG_PATH = path.join(os.homedir(), ".codex", "config.toml");
const CHILD_ENV = createChildEnv();
const BUILD_PROFILE = "ci-test";

const SUPPORTED_PATCHES = {
  "0.117.0": {
    tag: "rust-v0.117.0",
    patchFile: path.join(PACKAGE_ROOT, "patches", "rust-v0.117.0.patch")
  }
};

async function installSlopex({ postinstall = false } = {}) {
  ensureDir(WORK_ROOT);

  const codexInstall = resolveCodexInstall();
  if (!codexInstall) {
    const message =
      "Codex is not installed globally. Install it first with: npm install -g @openai/codex";
    if (postinstall) {
      console.warn(`[slopex] ${message}`);
      return;
    }
    throw new Error(message);
  }

  const support = SUPPORTED_PATCHES[codexInstall.version];
  if (!support) {
    const supportedVersions = Object.keys(SUPPORTED_PATCHES).join(", ");
    throw new Error(
      `Codex ${codexInstall.version} is not supported by this slopex release. Supported versions: ${supportedVersions}`
    );
  }

  const patchedBinary = await resolvePatchedBinary(codexInstall.version);
  if (!patchedBinary) {
    const message = [
      `No prebuilt slopex binary is available for Codex ${codexInstall.version} on ${artifactPlatformKey()}.`,
      "Run `slopex build-artifact` once to create a local cached artifact, or publish a matching GitHub release asset, then rerun `slopex install`."
    ].join(" ");
    if (postinstall) {
      console.warn(`[slopex] ${message}`);
      return;
    }
    throw new Error(message);
  }

  ensureDir(BACKUP_ROOT);
  const backupBinary = path.join(BACKUP_ROOT, `codex-${codexInstall.version}.original`);
  if (!fs.existsSync(backupBinary)) {
    fs.copyFileSync(codexInstall.vendorBinary, backupBinary);
  }

  replaceBinaryAtomically(patchedBinary, codexInstall.vendorBinary);

  writeManagedConfigBlock();
  const state = {
    installedAt: new Date().toISOString(),
    slopexVersion: PACKAGE_JSON.version,
    codexVersion: codexInstall.version,
    codexDir: codexInstall.codexDir,
    vendorBinary: codexInstall.vendorBinary,
    backupBinary,
    artifactBinary: patchedBinary,
    binarySha256: sha256File(codexInstall.vendorBinary)
  };
  fs.writeFileSync(INSTALL_STATE_PATH, `${JSON.stringify(state, null, 2)}\n`);

  console.log(`slopex installed for Codex ${codexInstall.version}`);
  console.log(`patched binary: ${codexInstall.vendorBinary}`);
  console.log(`artifact source: ${patchedBinary}`);
  console.log(`continuity root: ${path.join(os.homedir(), ".codex", "obsidian_graph")}`);
}

async function buildArtifact() {
  ensureDir(WORK_ROOT);

  const codexInstall = resolveCodexInstall();
  if (!codexInstall) {
    throw new Error(
      "Codex is not installed globally. Install it first with: npm install -g @openai/codex"
    );
  }

  const support = SUPPORTED_PATCHES[codexInstall.version];
  if (!support) {
    const supportedVersions = Object.keys(SUPPORTED_PATCHES).join(", ");
    throw new Error(
      `Codex ${codexInstall.version} is not supported by this slopex release. Supported versions: ${supportedVersions}`
    );
  }

  const artifactBinary = buildPatchedArtifact(support, codexInstall.version);
  console.log(`built slopex artifact: ${artifactBinary}`);
}

async function cacheBinary(binaryPath) {
  const resolvedPath = path.resolve(binaryPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Binary not found: ${resolvedPath}`);
  }

  const codexInstall = resolveCodexInstall();
  if (!codexInstall) {
    throw new Error(
      "Codex is not installed globally. Install it first with: npm install -g @openai/codex"
    );
  }

  const artifactBinary = cachedArtifactBinaryPath(codexInstall.version);
  ensureDir(path.dirname(artifactBinary));
  fs.copyFileSync(resolvedPath, artifactBinary);
  fs.chmodSync(artifactBinary, 0o755);
  console.log(`cached slopex artifact: ${artifactBinary}`);
}

async function printStatus() {
  const codexInstall = resolveCodexInstall();
  if (!codexInstall) {
    console.log("Codex is not installed globally.");
    return;
  }

  const state = readInstallState();
  const configText = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, "utf8") : "";
  const managedConfigPresent = configText.includes("# BEGIN slopex");

  console.log(`codex version: ${codexInstall.version}`);
  console.log(`codex dir: ${codexInstall.codexDir}`);
  console.log(`codex vendor binary: ${codexInstall.vendorBinary}`);
  console.log(`slopex config block: ${managedConfigPresent ? "present" : "missing"}`);
  console.log(
    `bundled artifact: ${resolveArtifactCandidate(codexInstall.version, BUNDLED_ARTIFACT_ROOT) || "missing"}`
  );
  console.log(
    `cached artifact: ${resolveArtifactCandidate(codexInstall.version, ARTIFACT_ROOT) || "missing"}`
  );
  console.log(`release asset url: ${releaseArtifactUrl(codexInstall.version)}`);
  if (!state) {
    console.log("slopex install state: not found");
    return;
  }

  console.log(`slopex version: ${state.slopexVersion}`);
  console.log(`artifact binary: ${state.artifactBinary || "unknown"}`);
  console.log(`backup binary: ${state.backupBinary}`);
  console.log(
    `patched binary hash matches state: ${sha256File(codexInstall.vendorBinary) === state.binarySha256}`
  );
}

async function uninstallSlopex() {
  const state = readInstallState();
  if (!state) {
    throw new Error("No slopex install state was found. Nothing to uninstall.");
  }

  if (!fs.existsSync(state.backupBinary)) {
    throw new Error(`Backup binary not found at ${state.backupBinary}`);
  }

  replaceBinaryAtomically(state.backupBinary, state.vendorBinary);
  removeManagedConfigBlock();
  fs.rmSync(INSTALL_STATE_PATH, { force: true });

  console.log(`Restored original Codex binary from ${state.backupBinary}`);
}

function resolveCodexInstall() {
  const npmRoot = runChecked("npm", ["root", "-g"]).stdout.trim();
  const codexDir = path.join(npmRoot, "@openai", "codex");
  if (!fs.existsSync(codexDir)) {
    return null;
  }

  const packageJsonPath = path.join(codexDir, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`Could not find Codex package.json at ${packageJsonPath}`);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const vendorBinary = findVendorBinary(codexDir);
  if (!vendorBinary) {
    throw new Error(`Could not locate the Codex vendor binary inside ${codexDir}`);
  }

  return {
    npmRoot,
    codexDir,
    version: packageJson.version,
    vendorBinary
  };
}

function findVendorBinary(codexDir) {
  const root = path.join(codexDir, "node_modules");
  if (!fs.existsSync(root)) {
    return null;
  }

  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (
        entry.isFile() &&
        entry.name === "codex" &&
        fullPath.includes(`${path.sep}vendor${path.sep}`) &&
        fullPath.includes(`${path.sep}codex${path.sep}codex`)
      ) {
        return fullPath;
      }
    }
  }
  return null;
}

function ensureBuildPrerequisites() {
  ensureCommand("git", ["--version"], "Install git before running slopex.");
  ensureCommand(
    "cargo",
    ["--version"],
    "Install Rust and Cargo before running slopex: https://rustup.rs"
  );
  ensureCommand("rustup", ["--version"], "Install rustup before running slopex.");
  ensureCommand("pkg-config", ["--version"], "Install pkg-config before running slopex.");

  if (process.platform === "linux") {
    const libcap = spawnSync("pkg-config", ["--exists", "libcap"], {
      stdio: "ignore"
    });
    if (libcap.status !== 0) {
      throw new Error(
        "Linux builds require libcap development headers. Install them first, for example: apt-get install -y libcap-dev"
      );
    }
  }
}

function ensurePatchFileExists(patchFile) {
  if (!fs.existsSync(patchFile)) {
    throw new Error(`Missing bundled slopex patch file: ${patchFile}`);
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

  const describe = runChecked("git", ["-C", repoDir, "describe", "--tags", "--exact-match"]);
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

  throw new Error(
    `Unable to apply slopex patch cleanly in ${repoDir}. Delete ${repoDir} and try again.`
  );
}

function buildPatchedCodex(repoDir) {
  runInherited(
    "cargo",
    ["build", "--profile", BUILD_PROFILE, "-p", "codex-cli", "--bin", "codex"],
    {
      cwd: path.join(repoDir, "codex-rs")
    }
  );
}

function buildPatchedArtifact(support, codexVersion) {
  ensureBuildPrerequisites();
  ensurePatchFileExists(support.patchFile);

  const repoDir = ensureSourceCheckout(support.tag);
  applyPatchIfNeeded(repoDir, support.patchFile);
  buildPatchedCodex(repoDir);

  const builtBinary = path.join(repoDir, "codex-rs", "target", BUILD_PROFILE, "codex");
  if (!fs.existsSync(builtBinary)) {
    throw new Error(`Expected built binary at ${builtBinary}, but it was not found.`);
  }

  const artifactBinary = cachedArtifactBinaryPath(codexVersion);
  ensureDir(path.dirname(artifactBinary));
  fs.copyFileSync(builtBinary, artifactBinary);
  fs.chmodSync(artifactBinary, 0o755);
  return artifactBinary;
}

function replaceBinaryAtomically(sourceBinary, targetBinary) {
  const tempTarget = `${targetBinary}.slopex.tmp`;
  fs.copyFileSync(sourceBinary, tempTarget);
  fs.chmodSync(tempTarget, 0o755);
  fs.renameSync(tempTarget, targetBinary);
}

async function resolvePatchedBinary(codexVersion) {
  const localArtifact =
    resolveArtifactCandidate(codexVersion, BUNDLED_ARTIFACT_ROOT) ||
    resolveArtifactCandidate(codexVersion, ARTIFACT_ROOT);
  if (localArtifact) {
    return localArtifact;
  }
  return downloadReleaseArtifact(codexVersion, { allowFailure: true });
}

function resolveArtifactCandidate(codexVersion, rootDir) {
  const candidate = artifactBinaryPath(rootDir, codexVersion);
  return fs.existsSync(candidate) ? candidate : null;
}

function cachedArtifactBinaryPath(codexVersion) {
  return artifactBinaryPath(ARTIFACT_ROOT, codexVersion);
}

function artifactBinaryPath(rootDir, codexVersion) {
  return path.join(rootDir, codexVersion, artifactPlatformKey(), executableName("codex"));
}

function releaseArtifactName(codexVersion) {
  return executableName(`slopex-codex-${codexVersion}-${artifactPlatformKey()}`);
}

function releaseArtifactUrl(codexVersion) {
  return `https://github.com/${repositorySlug()}/releases/download/v${PACKAGE_JSON.version}/${releaseArtifactName(codexVersion)}`;
}

function repositorySlug() {
  const repositoryUrl = typeof PACKAGE_JSON.repository === "string"
    ? PACKAGE_JSON.repository
    : PACKAGE_JSON.repository?.url;
  const match = repositoryUrl && repositoryUrl.match(/github\.com[:/](.+?)(?:\.git)?$/);
  if (!match) {
    throw new Error(`Unable to derive GitHub repository slug from package.json repository: ${repositoryUrl}`);
  }
  return match[1];
}

async function downloadReleaseArtifact(codexVersion, { allowFailure = false } = {}) {
  const targetBinary = cachedArtifactBinaryPath(codexVersion);
  const tempTarget = `${targetBinary}.download`;
  const url = releaseArtifactUrl(codexVersion);

  try {
    ensureDir(path.dirname(targetBinary));
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) {
      throw new Error(`download failed with HTTP ${response.status} for ${url}`);
    }

    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(tempTarget));
    fs.chmodSync(tempTarget, 0o755);
    fs.renameSync(tempTarget, targetBinary);
    return targetBinary;
  } catch (error) {
    fs.rmSync(tempTarget, { force: true });
    if (allowFailure) {
      return null;
    }
    throw error;
  }
}

function artifactPlatformKey() {
  const platform = process.platform;
  const arch = process.arch;
  return `${platform}-${arch}`;
}

function executableName(baseName) {
  return process.platform === "win32" ? `${baseName}.exe` : baseName;
}

function writeManagedConfigBlock() {
  ensureDir(path.dirname(CONFIG_PATH));
  const managedBlock = [
    "# BEGIN slopex",
    'experimental_auto_compact_mode = "reset"',
    'experimental_obsidian_graph_root = "~/.codex/obsidian_graph"',
    "experimental_obsidian_graph_background_agent = true",
    "# END slopex"
  ].join("\n");

  const existing = fs.existsSync(CONFIG_PATH) ? fs.readFileSync(CONFIG_PATH, "utf8") : "";
  const next = upsertManagedBlock(existing, managedBlock);
  fs.writeFileSync(CONFIG_PATH, `${next.trimEnd()}\n`);
}

function removeManagedConfigBlock() {
  if (!fs.existsSync(CONFIG_PATH)) {
    return;
  }
  const existing = fs.readFileSync(CONFIG_PATH, "utf8");
  const next = existing.replace(
    /\n?# BEGIN slopex[\s\S]*?# END slopex\n?/g,
    "\n"
  );
  fs.writeFileSync(CONFIG_PATH, `${next.trimEnd()}\n`);
}

function upsertManagedBlock(existing, managedBlock) {
  if (existing.includes("# BEGIN slopex")) {
    return existing.replace(
      /# BEGIN slopex[\s\S]*?# END slopex/g,
      managedBlock
    );
  }
  if (!existing.trim()) {
    return managedBlock;
  }
  return `${existing.trimEnd()}\n\n${managedBlock}`;
}

function readInstallState() {
  if (!fs.existsSync(INSTALL_STATE_PATH)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(INSTALL_STATE_PATH, "utf8"));
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
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

module.exports = {
  SUPPORTED_PATCHES,
  artifactPlatformKey,
  buildArtifact,
  cacheBinary,
  installSlopex,
  printStatus,
  releaseArtifactName,
  releaseArtifactUrl,
  uninstallSlopex
};
