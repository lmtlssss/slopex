# slopex

`slopex` patches a globally installed `@openai/codex` runtime so long chats stop compacting into progressively degraded summary capsules.

Instead of summary compaction, slopex makes Codex:

- reset the live context window back to a fresh base,
- export the previous thread into an Obsidian-style continuity graph,
- keep chronological and semantic notes in that graph,
- preserve a pointer from fresh turns back to the graph and raw history archive.

## What It Changes

- Auto-compaction resets live history instead of summarizing it.
- `/compact` follows the same reset-to-graph flow.
- Continuity is written under `~/.codex/obsidian_graph`.
- A background organizer agent maintains `index.md`, `timeline/`, `themes/`, and links to raw segment archives.

## Install

Codex must already be installed:

```bash
npm install -g @openai/codex
npm install -g slopex
```

Normal installs are fast. `slopex install` now looks for a prebuilt patched Codex artifact in this order:

1. bundled artifact in the package,
2. cached local artifact under `~/.slopex/artifacts`,
3. matching GitHub release asset for the current `slopex` version.

That means published installs do not need to compile Codex from source during postinstall.

## Commands

```bash
slopex install
slopex status
slopex uninstall
```

Maintainer-only helpers:

```bash
slopex build-artifact
slopex cache-binary /path/to/patched/codex
```

## Automation

The repo includes a GitHub Actions release workflow at `.github/workflows/release.yml`.

On every push to `main`, the workflow:

- reads the supported Codex version from `lib/patcher.js`,
- bumps the npm version if the current version is already published,
- builds a patched Codex artifact,
- pushes the release commit and tag back to `main`,
- creates a GitHub release with the patched binary as an asset,
- publishes the npm package.

With `NPM_TOKEN` configured as a GitHub Actions secret, future updates only need one push to `main`.

## Uninstall

```bash
slopex uninstall
```

This restores the original backed-up Codex binary and removes the managed `slopex` config block from `~/.codex/config.toml`.

## Notes

- `slopex` currently ships a version-specific patch bundle for supported Codex releases.
- The current release automation builds a `linux-x64` artifact. Add more runners and artifacts in the workflow to expand platform coverage.
- If Codex is missing, `slopex` tells the user to install `@openai/codex` first.
