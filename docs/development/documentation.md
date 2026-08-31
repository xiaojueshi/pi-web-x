# Documentation conventions

[Documentation index](../README.md) · [Contributing](../../CONTRIBUTING.md)

Documentation is part of the product contract. Update it in the same change as the behavior it describes.

## Audience and source of truth

| Information | Authoritative document |
| --- | --- |
| Product overview and minimum installation | Root `README.md` |
| User task instructions | `docs/guides/` |
| Development commands and PR workflow | `CONTRIBUTING.md` |
| Runtime architecture and validation | `docs/development/` |
| Current security model and vulnerability reporting | `SECURITY.md` |
| Why an architecture decision exists | `docs/adr/` (existing Agent dependency path) |
| Current dependency replacement status | `docs/maintainers/runtime-substitution-matrix.md` |
| Removable local workaround | `docs/maintainers/upstream-workarounds.md` |
| Concise version changes | `CHANGELOG.md` |
| Full release text | `docs/maintainers/release-notes/` |
| Completed migration history | `docs/history/` |
| Agent-only repository rules | `AGENTS.md` |

Avoid copying a complete procedure into several files. Summarize at the higher-level entry and link to the authority.

## Directory rules

- `docs/guides/`: task-oriented user instructions and troubleshooting.
- `docs/development/`: current contributor-facing technical contracts.
- `docs/adr/` and root `CONTEXT.md`: established Agent/architecture dependencies; do not reorganize as public guide cleanup.
- `docs/history/`: completed developer plans retained for context; never presented as unfinished current work.
- `docs/maintainers/`: release, dependency, and upstream maintenance procedures.

Root Markdown files are limited to conventional open-source entry points, compatibility pages for historically public URLs, and automation instructions.

## Language

- Root `README.md` is the canonical English project entry.
- `README.zh-CN.md`, `README.ja.md`, and `README.ru.md` are complete translations with the same major sections and language bar.
- Deep technical documents may keep their established language to avoid duplicate sources of truth. The documentation index must describe their audience and location.
- Code identifiers, CLI commands, paths, environment variables, API fields, product names, and provider/model names remain unchanged in translation.
- Use **Pi Web X** for this product. Use “pi-web” only for the upstream project or historical migration.

When changing one README, check the other README files for feature, command, security, and link parity. Exact sentence-level parity is not required, but no translation may advertise an obsolete command or weaker security model.

## Document status

- Current guides contain no “planned” behavior unless marked explicitly.
- Historical records start with a visible historical/completed notice.
- Existing ADR and Agent context files retain their current path and format unless a separate architecture task explicitly changes them.
- Release notes use `Draft` before release and `Released` afterward. Released notes are frozen except for factual/link corrections, which should be noted.
- Temporary workarounds remain in the registry after removal with status `已移除` for traceability.

## Links and moves

Use relative links for files within the repository and absolute HTTPS URLs for external sources. Link to a file rather than duplicating it.

When moving a public document:

1. use `git mv` to preserve history;
2. update every repository reference;
3. keep a short compatibility page at well-known root paths such as `MIGRATION.md` and `CONTEXT.md` when old Releases may link there;
4. do not use filesystem symlinks for Markdown compatibility;
5. run the documentation link test.

Links inside `.pi/skills/` are skill implementation material rather than public project documentation and follow that skill's own structure.

## Style

- Begin with one H1 and a short statement of purpose.
- Add links back to the documentation index and adjacent guides.
- Prefer task-oriented headings and copyable commands.
- State prerequisites, security implications, expected result, and troubleshooting for operational procedures.
- Avoid hard-coded test counts; they become stale immediately.
- Use tables for bounded comparisons, not long prose that hides different semantics.
- Keep warnings factual and actionable.
- Do not document hidden/test-only interfaces as public features.

## Updating behavior

A change is incomplete when it changes any of the following without updating its authority document:

- CLI options or environment variables;
- installation paths, artifact names, or runtime requirements;
- authentication, network exposure, or file/command security boundaries;
- supported platforms or release process;
- TypeScript runtime/type declarations;
- architecture decisions or dependency replacement status;
- user-visible PWA, worktree, model, plugin, or session behavior.

## Validation

Run:

```bash
bun test tests/unit/docs-links.test.ts
bun run typecheck
bun run lint
```

The link test checks maintained root/docs Markdown relative targets. Review translated README content manually for semantic parity and check rendered tables/code blocks in GitHub before release.
