# Release notes archive

[Maintainer documentation](../README.md) · [Release process](../release.md) · [Changelog](../../../CHANGELOG.md)

Release notes are the complete, reviewable source text for GitHub Releases. `CHANGELOG.md` remains the concise cross-version history.

| Version | Status | Notes |
| --- | --- | --- |
| [v0.9.4](./v0.9.4.md) | Released | Auth keepalive, session persistence, test isolation |
| [v0.9.3](./v0.9.3.md) | Released | Update-check fallback |
| [v0.9.2](./v0.9.2.md) | Released | Windows CI path hotfix |
| [v0.9.1](./v0.9.1.md) | Released | Service recovery and SDK update |
| [v0.9.0](./v0.9.0.md) | Released | Browser authentication and PWA companion |

## Lifecycle

1. Create `vX.Y.Z.md` while preparing a release and mark it `Draft`.
2. Base user-visible changes on `CHANGELOG.md`, then add compatibility, security, exact Bun version, eight targets, assets, checksums, and installation notes.
3. **Every release note must state, item by item, what changed and which functionality improved** — not just headings or one-line summaries. For each fixed bug or new capability, explain the behavior that changed, the user-visible effect (which problem disappeared, whether usage changed), and the affected entry points (commands, pages, APIs). Keep the `概要 → 新增与改进 → 修复 → 兼容与安全 → 构建与制品` structure from the archive templates; a release that only repeats titles or omits user-visible effects must not be published.
4. Review the document with the generated Draft Release.
5. After publication, change status to `Released` and freeze the content.
6. Later edits are limited to broken links or factual corrections and should be noted in the commit/PR.

Use the [release process](../release.md) as the authoritative checklist.
