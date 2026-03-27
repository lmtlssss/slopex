#!/usr/bin/env node

const {
  buildArtifact,
  cacheBinary,
  installSlopex,
  printStatus,
  uninstallSlopex
} = require("../lib/patcher");

async function main() {
  const [command = "install", ...args] = process.argv.slice(2);
  const postinstall = args.includes("--postinstall");

  switch (command) {
    case "install":
      await installSlopex({ postinstall });
      break;
    case "build-artifact":
      await buildArtifact();
      break;
    case "cache-binary":
      if (!args[0]) {
        throw new Error("Usage: slopex cache-binary <path-to-patched-codex>");
      }
      await cacheBinary(args[0]);
      break;
    case "status":
      await printStatus();
      break;
    case "uninstall":
      await uninstallSlopex();
      break;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      break;
    default:
      console.error(`Unknown slopex command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

function printHelp() {
  console.log(`slopex

Commands:
  slopex install     Patch the installed Codex runtime in place.
  slopex build-artifact
                     Build and cache a local patched Codex artifact.
  slopex cache-binary <path>
                     Cache an existing patched Codex binary for fast installs.
  slopex status      Show Codex and slopex patch status.
  slopex uninstall   Restore the original Codex binary if a slopex backup exists.
`);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exitCode = 1;
});
