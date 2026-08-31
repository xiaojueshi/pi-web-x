# Architecture overview

[Documentation index](../README.md) · [Bun/Node boundaries](./bun-and-node.md) · [Architecture decisions](../adr/)

Pi Web X is a Bun-native HTTP/SSE server with a React client. It intentionally avoids a general web framework compatibility layer and produces platform-native executables with `bun build --compile`.

## Request path

```text
Browser
  │ HTTP / SSE
  ▼
src/server.ts
  ├── src/server/security.ts      public-server security gate
  ├── src/server/routes.ts        statically imported API route table
  ├── src/server/http.ts          minimal legacy JSON/nextUrl adapter
  ├── src/server/public-assets.ts embedded public assets
  └── src/client/index.html       Bun HTML import → React CSR bundle
                                      │
                                      └── src/client/main.tsx
```

`src/cli.ts` parses commands, registers Bun compiled-runtime modules, bootstraps directory assets, and starts the server. `src/server.ts` creates a public listener plus a loopback-only HTML asset listener used by Bun's HTML import output.

## Server boundary

- API handlers use Web-standard `Request` and `Response`.
- `src/server/http.ts` implements only the minimal compatibility surface still required by migrated business modules; it must not grow into a Next.js emulation layer.
- Route imports in `src/server/routes.ts` remain static so Bun can collect every API dependency into compiled executables.
- All public requests pass Host, authentication, and cache/security-header checks before route dispatch; browser API requests additionally pass Origin/Fetch Metadata checks.
- `/api/*` paths, methods, status codes, JSON fields, and SSE event semantics are compatibility contracts.

## Client boundary

The browser client uses React 19 client-side rendering. There is no RSC or SSR process. Bun bundles `src/client/index.html`, TSX, CSS, fonts, and browser dependencies at build time.

Navigation is implemented by the location store in `src/client/navigation.ts`. Calls to `history.replaceState()` must emit `pi-web-x:navigation` because browsers do not dispatch `popstate` for that operation.

The client talks only to the Pi Web X HTTP/SSE API. It does not read `~/.pi/agent`, spawn commands, or access project files directly.

## Agent sessions

`AgentSessionWrapper` bridges API requests to the pi-coding-agent SDK. Wrappers are retained on `globalThis.__piSessions` so hot reload or repeated startup does not discard active sessions.

Important lifecycle rules:

- `fork()` mutates the underlying session id; destroy the old wrapper after forking.
- `entryIds[]` stays aligned with display messages for fork and in-session branch operations.
- Chat-only mode is a persisted resource policy, not simply an empty runtime tool array.
- Built-in subagents are disabled by default and fail closed when their settings are damaged.

## Data and file access

Pi shared data remains under `~/.pi/agent`. Pi Web X-owned installation, authentication, and service data lives under `~/.pi-web-x` (with platform-specific service definitions/logs where required).

File APIs authorize only:

- the current session cwd;
- the canonical project root;
- explicitly authorized roots;
- managed `~/pi-cwd-*` directories;
- exact external files proven by a trusted session reference where supported.

Symlink resolution and path canonicalization are part of the security boundary.

## Environment isolation

The **Host Runtime Environment** belongs to the Bun server. The **Project Command Environment** belongs to commands invoked for a selected project. Built-in project shells sanitize host-only environment variables before execution. See [ADR 0001](../adr/0001-isolate-project-command-environments.md) and the established [Agent/domain context](../../CONTEXT.md).

## Compiled-runtime assets

Bun collects literal static/dynamic imports, but not every variable-form dynamic import. `src/bun-runtime-modules.ts` statically registers the public pi-ai OAuth and Bedrock modules needed by a compiled executable. A compiled-binary regression test verifies those modules through public provider APIs.

Browser assets are embedded. Directory-shaped SDK assets (themes, interactive assets, export templates) are released as a versioned archive and bootstrapped beside the executable. User plugins, skills, prompts, themes, and configuration remain dynamically discovered user data and are never compiled into the product.

## Runtime model

Bun is the source runtime, test runner, package manager, bundler, and executable compiler. The project uses `node:*` modules only through Bun's compatibility implementation. The optional npm launcher is the sole supported path that actually executes under Node.js. See [Bun and Node.js boundaries](./bun-and-node.md).

## Change checklist

When changing architecture-sensitive code, verify the relevant contracts:

1. API/SSE compatibility and route precedence.
2. Host/Origin/authentication checks on the public listener.
3. project-command environment sanitization.
4. file access and symlink boundaries.
5. compiled executable behavior rather than source-only behavior.
6. all eight release targets when runtime imports or native dependencies change.
7. the matching ADR, maintainer matrix, or upstream workaround record.
