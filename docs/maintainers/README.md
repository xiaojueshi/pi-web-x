# Maintainer documentation

[Documentation index](../README.md) · [Contributing](../../CONTRIBUTING.md)

This directory contains release and dependency-maintenance procedures. It is not the user installation guide.

## Documents

- [Release process](./release.md): release gates, artifacts, smoke tests, tags, and install-script checks.
- [Runtime substitution matrix](./runtime-substitution-matrix.md): current decisions about retained, replaced, or candidate dependencies/APIs.
- [Temporary upstream workarounds](./upstream-workarounds.md): local implementations that should be removed after an upstream capability becomes available.
- [Release notes](./release-notes/README.md): frozen full release documents.

## Update rules

- Runtime/dependency changes update the matrix in the same commit.
- A local upstream workaround must have an owner, affected version, reproduction, removal condition, rollback, and compiled-product validation.
- A Release freezes its release-note file after publication except for factual/link corrections.
- Changes to installation, artifact names, checksums, service recovery, or platform targets update the release process and relevant user guide.
- Agent dependency files under `docs/adr/**`, `CONTEXT.md`, and `.pi/**` are outside normal public-document reorganization.

The concise public version history remains [CHANGELOG.md](../../CHANGELOG.md).
