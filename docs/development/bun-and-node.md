# Bun and Node.js boundaries

[Documentation index](../README.md) · [Architecture](./architecture.md) · [Testing](./testing.md)

Pi Web X replaces the Node.js **server runtime and build chain** with Bun. It does not forbid the Node.js API vocabulary that Bun implements, and it keeps one optional Node.js npm launcher for users who install through npm.

## Runtime matrix

| Context | Actual runtime | Type declarations | Notes |
| --- | --- | --- | --- |
| `src/**`, `app/**`, `lib/**` server code | Bun 1.4.0 | `bun` + `node` | `node:*` resolves to Bun compatibility implementations |
| Client bundle | Browser | DOM + shared TS types | Must not depend on server-only globals at runtime |
| Unit tests | Bun test runner | `bun` + `node` | Tests may use Bun APIs and compatible `node:*` modules |
| Build scripts | Bun | `bun` + `node` | Prefer Bun APIs when they improve behavior without reducing compatibility |
| Compiled Release executable | Embedded Bun runtime | Types are compile-time only | End users install neither Bun nor Node.js |
| `bin/pi-web-x.js` npm launcher | Node.js | Node-compatible JS | Locates and starts a packaged native executable; it is not the server |

## Explicit TypeScript declarations

The repository deliberately declares both environments in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "types": ["bun", "node"]
  }
}
```

`src/runtime.d.ts` also records the same boundary and defines Bun HTML import and CSS Module declarations.

- `@types/bun` / `bun-types` describe `Bun`, `Bun.serve`, `Bun.build`, `bun:test`, HTML imports, and other Bun APIs.
- `@types/node` describes imports such as `node:path`, `node:fs`, `node:crypto`, and `node:child_process` that Bun implements for compatibility.
- Both packages are development-only declarations. They add no runtime dependency to a compiled executable.

Explicit `compilerOptions.types` prevents unrelated transitive `@types/*` packages from silently adding globals and makes editor/CI behavior reproducible.

## Why `node:*` imports remain

Replacing Node.js as the runtime does not require rewriting stable standard-library APIs merely to remove the `node:` prefix. Bun provides native implementations for the Node.js modules used by this project. Keeping those imports can provide:

- mature cross-platform path and filesystem semantics;
- compatibility with pi SDK and ecosystem packages;
- smaller migration risk than unnecessary wrappers;
- readable, typed APIs available in both Bun source execution and compiled executables.

An API should be replaced with a Bun-specific API only when there is a measured benefit and equivalent behavior is covered by tests. Current decisions are tracked in the [runtime substitution matrix](../maintainers/runtime-substitution-matrix.md).

## APIs that should be Bun-native

The project uses Bun directly where Bun is the product boundary:

- `Bun.serve` for HTTP serving;
- `Bun.build({ compile: ... })` / `bun build --compile` for releases;
- Bun HTML imports for the browser bundle;
- `bun:test` for tests;
- `Bun.spawn`/`Bun.spawnSync` where command behavior has been verified;
- `Bun.CryptoHasher` where its semantics match the replaced implementation.

Do not introduce a Node.js HTTP server, Next.js server, Node-only loader, or Node-based build step into the application path.

## npm launcher exception

The npm package exposes `bin/pi-web-x.js` with `#!/usr/bin/env node`. npm users already have Node.js available to run this small launcher. The launcher only parses `--help`/`--version`, locates `dist/pi-web-x` (or `.exe`), and starts the native executable.

Documentation must distinguish:

- **Release binary:** no Node.js or Bun required.
- **npm launcher:** Node.js required for the launcher.
- **source development:** Bun 1.4.0 required; Node.js is not the application runtime.

The npm route must never be advertised as Node-free.

## Import and compile rules

Bun's executable compiler must be able to discover every production module:

- prefer static imports for route tables and runtime registrations;
- literal dynamic imports are acceptable when Bun can collect them;
- variable-form dynamic imports require a public static registration seam and a compiled-binary regression test;
- never import private `node_modules/**/dist` paths as a long-term workaround;
- user resources remain disk-discovered and must not be compiled into the executable.

See [temporary upstream workarounds](../maintainers/upstream-workarounds.md) for currently registered opaque modules.

## Validation

After changing runtime APIs, types, dependencies, or imports, run:

```bash
bun run typecheck
bun test
bun run build
```

When a change affects compile collection, native modules, platform paths, or release assets, also run the focused compiled-binary test and `bun run build:all` before release. Source-only success is not sufficient evidence.
