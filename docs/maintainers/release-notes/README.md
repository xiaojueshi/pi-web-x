# Release notes archive

[Maintainer documentation](../README.md) · [Release process](../release.md) · [Changelog](../../../CHANGELOG.md)

Release notes are the complete, reviewable source text for GitHub Releases. `CHANGELOG.md` remains the concise cross-version history.

| Version | Status | Notes |
| --- | --- | --- |
| [v0.9.3](./v0.9.3.md) | Released | Update-check fallback |
| [v0.9.2](./v0.9.2.md) | Released | Windows CI path hotfix |
| [v0.9.1](./v0.9.1.md) | Released | Service recovery and SDK update |
| [v0.9.0](./v0.9.0.md) | Released | Browser authentication and PWA companion |

## Lifecycle

1. Create `vX.Y.Z.md` while preparing a release and mark it `Draft`.
2. Base user-visible changes on `CHANGELOG.md`, then add compatibility, security, exact Bun version, eight targets, assets, checksums, and installation notes.
3. Review the document with the generated Draft Release.
4. After publication, change status to `Released` and freeze the content.
5. Later edits are limited to broken links or factual corrections and should be noted in the commit/PR.

Use the [release process](../release.md) as the authoritative checklist.
