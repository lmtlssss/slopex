# sloppydisk

`sloppydisk` is a small reset-based continuity patcher for `@openai/codex`.

It replaces summary-style compaction with reset-style continuity so long chats can clear live context and recover continuity from an Obsidian-style graph instead of stuffing an ever-growing summary capsule back into the model.

## What It Does

- auto-compaction resets live history instead of summarizing it
- `/compact` follows the same reset flow
- continuity is written under `~/.codex/obsidian_graph`
- `stock` restores the original Codex binary when a safe backup exists, or repairs Codex from the official npm package if it does not, then removes the managed config block

## Install

Codex must already be installed:

```bash
npm install -g @openai/codex
npm install -g sloppydisk
```

Package install patches Codex automatically. The explicit helper commands are only for repatching, restoring stock behavior, and inspection:

```bash
sloppydisk patch
sloppydisk stock
sloppydisk status
```

The installed package does not build Codex from source. It only does this:

1. find a matching patched binary
2. back up the current Codex binary once
3. swap in the patched binary
4. write the managed config block

Patched binaries are resolved in this order:

1. bundled artifact in the package
2. cached artifact under `~/.slopex/artifacts`
3. matching GitHub release asset for the current package version

## Maintainers

Release artifact builds are kept out of the shipped runtime. If you are working in the repo itself, use:

```bash
npm run build-release-artifact
```

The GitHub Actions release workflow can call that script and publish the resulting artifact without making normal installs compile Codex locally.
