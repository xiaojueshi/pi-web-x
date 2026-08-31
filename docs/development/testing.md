# Testing and validation

[Documentation index](../README.md) · [Contributing](../../CONTRIBUTING.md) · [Release process](../maintainers/release.md)

Pi Web X validates both source behavior and Bun-compiled executable behavior. A test that passes only under `bun test` does not prove that opaque dynamic imports, embedded assets, or platform-specific paths are present in a release artifact.

## Command matrix

| Command | Scope | Use when |
| --- | --- | --- |
| `bun test` | All non-E2E Bun tests | Default local/CI test suite |
| `bun run test:bun` | Tests under `tests/` | Focused route/unit suite |
| `bun test <path>` | One test file or directory | Fast iteration |
| `bun run typecheck` | Application, API, client, shared libraries, and build scripts | Any TS/type/config change |
| `bun run lint` | ESLint and React hooks | Any source change |
| `bun run build` | Linux x64 compiled executable | Runtime/import/build changes |
| `bun run build:all` | Eight release targets | Release and cross-platform-sensitive changes |
| `bun run test:e2e` | Build plus Playwright black-box tests | Browser/API/PWA release behavior |

Use Bun commands directly; do not replace them with `npm test`, `node --test`, Next.js build commands, or a Node loader.

The strict `tsconfig.json` project covers production TypeScript and `scripts/**/*.ts`. Existing test files use intentionally lightweight mocks and are validated by `bun test` plus ESLint rather than all being part of that strict `tsc` project. New or changed tests must still be free of editor/LSP diagnostics in the touched code.

## Test layers

### Unit and contract tests

Tests under `tests/unit` cover pure logic, components, hooks, API contracts, security boundaries, session lifecycle, command environment isolation, service configuration, and release helpers. They use `bun:test`.

API tests should assert paths, methods, status codes, response fields, headers, and SSE event semantics rather than implementation details. Security tests must include rejection paths.

### Compiled-binary tests

Compiled tests build a minimal or full executable and execute it as a subprocess. They are required for:

- variable-form/dynamic runtime imports;
- Bun HTML imports and embedded public assets;
- directory asset bootstrap;
- native modules and platform binaries;
- CLI options and startup behavior;
- DOCX preview/runtime dependencies.

`tests/unit/src/bun-runtime-modules.test.ts` verifies that all registered OAuth flows and the Bedrock implementation load inside a real compiled executable. Extend this test when a new opaque runtime module is introduced.

### End-to-end tests

Playwright starts the compiled product, not a Next.js or Node development server. Its server fixture creates isolated browser-authentication state before startup and accesses the compiled binary with Basic credentials. E2E coverage includes protected HTTP/browser flows, PWA/Service Worker behavior, and offline guidance; setup-token, login, logout, and session persistence contracts remain covered by focused authentication tests.

## Isolation requirements

Tests that read Pi or Pi Web X state must use a temporary `HOME` and explicit temporary paths. Never read or write a developer's real:

```text
~/.pi/agent
~/.pi-web-x
```

Fixtures must contain no real provider keys, OAuth tokens, passwords, setup tokens, session Cookies, user names, or private project contents. Network calls should use local test servers or injected fetch implementations unless a separately approved integration test requires external access.

Temporary files belong under test-managed directories such as `tests/.tmp` and must be removed in `finally`/cleanup hooks.

## Platform-sensitive changes

Run `bun run build:all` before release when changing:

- filesystem paths, executable names, libc handling, shell quoting, service definitions, or process spawning;
- native/optional dependencies;
- Bun compile imports or asset collection;
- install/update scripts;
- signing, metadata, or packaging behavior.

A successful cross-target compile is necessary but not sufficient. Release validation executes at least `--help` and an HTTP smoke test on each target family; Linux must cover glibc and musl.

## Security-sensitive changes

Changes to request security, authentication, file access, command execution, credentials, service setup, or environment filtering should verify:

1. the intended allow path;
2. malformed and unauthenticated rejection paths;
3. symlink/path canonicalization where relevant;
4. no host secret leakage into project commands;
5. no access to real user data during tests.

Follow [SECURITY.md](../../SECURITY.md) and document intentional boundary changes in an ADR.

## Before opening a pull request

At minimum:

```bash
bun run typecheck
bun run lint
bun test
bun run build
```

Also run `git diff --check`. In the PR template, state the exact commands, platform, and any checks that were not run. Do not mark `build:all` or E2E complete unless they actually ran.

## Before release

Use the authoritative [release checklist](../maintainers/release.md). It adds frozen-lockfile install, all-target builds, artifact inventory, platform smoke tests, checksums, asset archives, version consistency, signing/notarization checks, and release-note review.
