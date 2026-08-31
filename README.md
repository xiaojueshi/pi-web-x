# Pi Web X

[English](./README.md) · [简体中文](./README.zh-CN.md) · [日本語](./README.ja.md) · [Русский](./README.ru.md)

Pi Web X is a Bun-native local web interface for the [pi coding agent](https://github.com/earendil-works/pi). It runs as a platform-native executable and uses pi's existing sessions, models, credentials, extensions, skills, prompts, and themes.

> Pi Web X is an independent implementation based on `pi-web@0.8.11` (`28bab3c`). Its product namespace is intentionally separate: it does not read or migrate legacy `pi-web:*` browser preferences or session custom entries.

## Highlights

- One native executable for macOS, Linux (glibc and musl), and Windows on x64/arm64.
- React 19 client rendered in the browser; no Next.js, RSC, SSR, or Node.js server runtime.
- Session browsing, Agent streaming, files, Git/worktrees, model and credential settings, plugins, skills, prompts, themes, subagents, and PWA support.
- Loopback-only by default, with Host/Origin checks and browser password authentication.
- Uses `~/.pi/agent` for shared pi data and `~/.pi-web-x` for Pi Web X-owned data.

## Install

### Install script

macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.sh | sh
```

Windows PowerShell 5.1 or later:

```powershell
irm https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.ps1 | iex
```

The scripts detect the OS, architecture, and Linux libc, download the matching GitHub Release, verify `SHA256SUMS`, and install the command for the current user. Review the script before piping it to a shell if required by your security policy.

### Manual download

Download the executable for your platform from [GitHub Releases](https://github.com/xiaojueshi/pi-web-x/releases), then run:

```bash
./pi-web-x
# Open http://127.0.0.1:30141
```

| Usage path | Bun required | Node.js required |
| --- | --- | --- |
| GitHub Release executable | No | No |
| Build from source | Bun 1.4.0 | No |
| Optional npm launcher | No | Yes, for the launcher only |
| Plugin/skill installation and some worktree actions | No | `git` and `npm`/`npx` may be required by the invoked feature |

The compiled executable embeds the Bun runtime. Imports such as `node:path` use Bun's Node.js compatibility APIs and do not turn Node.js into the server runtime.

See the [installation and update guide](./docs/guides/installation.md) for offline assets, mirrors, updates, and platform details.

## First run and security

On first startup, the server prints a one-time setup token to stderr. Open the browser, enter that token, and create a password. Later browser access uses an HttpOnly session cookie. Authentication data is stored under `~/.pi-web-x/auth/` and is separate from pi data in `~/.pi/agent`.

The default listener is `127.0.0.1`. Exposing `-H 0.0.0.0` makes a high-privilege project service reachable over the network. Use browser authentication or a long random `PI_WEB_X_PASSWORD`, plus HTTPS or a trusted VPN. See [SECURITY.md](./SECURITY.md) before network deployment.

## Run and configure

```text
pi-web-x [-p <port>] [-H <hostname>] [--no-open]
pi-web-x service install|uninstall
pi-web-x update [--check]
pi-web-x assets status
pi-web-x assets install <archive>
```

Common environment variables:

| Variable | Purpose |
| --- | --- |
| `PORT` | Port, default `30141` |
| `PI_WEB_X_HOSTNAME` | Listener address, default `127.0.0.1` |
| `PI_WEB_X_NO_OPEN` | Do not open a browser for `1/true/yes/on` |
| `PI_WEB_X_PASSWORD` | HTTP Basic Auth fallback with username `pi` |
| `PI_WEB_X_ALLOWED_HOSTS` | Additional trusted Host values, comma-separated |
| `PI_WEB_X_SKIP_VERSION_CHECK` | Disable update checks |

Detailed guides cover [configuration](./docs/guides/configuration.md), [browser authentication](./docs/guides/authentication.md), [system services](./docs/guides/system-service.md), [PWA behavior](./docs/guides/pwa.md), and [Git worktrees](./docs/guides/worktrees.md).

## Develop

Source development, tests, and release builds use **Bun 1.4.0**:

```bash
bun install --frozen-lockfile
bun run dev
bun test
bun run typecheck
bun run lint
bun run build
```

`bun run build` creates the Linux x64 executable; `bun run build:all` creates all eight release targets. TypeScript explicitly loads both `bun` and `node` declaration packages: Bun types describe the actual runtime, while Node types describe Bun-compatible `node:*` modules. Separately, the optional npm launcher is the only project path that executes under Node.js.

Read [CONTRIBUTING.md](./CONTRIBUTING.md), the [architecture overview](./docs/development/architecture.md), [runtime and type boundaries](./docs/development/bun-and-node.md), and the [test guide](./docs/development/testing.md) before making changes.

## Documentation and support

The [documentation index](./docs/README.md) separates user guides, development references, architecture decisions, migration history, and maintainer procedures.

- Questions and reproducible bugs: [GitHub Issues](https://github.com/xiaojueshi/pi-web-x/issues)
- Contribution workflow: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security vulnerabilities: [SECURITY.md](./SECURITY.md) — do not report secrets publicly
- Release history: [CHANGELOG.md](./CHANGELOG.md)
- Community expectations: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)

## License and origin

[MIT](./LICENSE). The upstream pi-web copyright and license notices are preserved. Historical migration details are in [`docs/history/bun-migration.md`](./docs/history/bun-migration.md); current dependency decisions and removable upstream workarounds are tracked under [`docs/maintainers/`](./docs/maintainers/).
