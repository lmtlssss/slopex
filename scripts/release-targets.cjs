#!/usr/bin/env node
const fs = require("node:fs");
const { SUPPORTED_PATCHES, artifactPlatformKey, releaseArtifactName } = require("../lib/patcher");

const codexVersion = Object.keys(SUPPORTED_PATCHES)[0];
if (!codexVersion) {
  throw new Error("No supported Codex versions are configured.");
}

const payload = {
  codex_version: codexVersion,
  platform_key: artifactPlatformKey(),
  asset_name: releaseArtifactName(codexVersion)
};

if (process.argv.includes("--github-output")) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    throw new Error("GITHUB_OUTPUT is not set.");
  }
  for (const [key, value] of Object.entries(payload)) {
    fs.appendFileSync(outputPath, `${key}=${value}\n`);
  }
} else {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}
