# CLI and environment configuration

[Documentation index](../README.md) · [Installation](./installation.md) · [Authentication](./authentication.md)

Pi Web X uses command-line options for one run and environment variables for stable deployment defaults. Command-line values take precedence over their matching environment defaults.

## Main command

```text
pi-web-x [options]

-p, --port <port>          Server port (default: 30141 or PORT)
-H, --hostname <host>      Bind host (default: 127.0.0.1 or PI_WEB_X_HOSTNAME)
    --no-open              Do not open the default browser
-v, --version              Print the version and exit
-h, --help                 Print help and exit
```

Examples:

```bash
pi-web-x --no-open
pi-web-x -p 8080 -H 127.0.0.1
PI_WEB_X_PASSWORD='use-a-long-random-secret' pi-web-x -H 0.0.0.0
```

Port `0` is accepted for an ephemeral development/test listener. Production and service configurations should use a stable non-zero port.

## Environment variables

### Listener and browser

| Variable | Meaning |
| --- | --- |
| `PORT` | Default port when `--port` is absent; default `30141` |
| `PI_WEB_X_HOSTNAME` | Default listener host when `--hostname` is absent; default `127.0.0.1` |
| `PI_WEB_X_NO_OPEN` | `1`, `true`, `yes`, or `on` disables automatic browser opening |
| `PI_WEB_X_ALLOWED_HOSTS` | Additional trusted hostnames for a proxy/custom hostname, comma-separated; configured ports are ignored |

`PI_WEB_X_ALLOWED_HOSTS` does not disable API Origin checks and is not a wildcard allowlist. Add only hostnames controlled by the deployment owner. IP-literal hosts are handled separately by the request-security policy.

### Authentication and proxying

| Variable | Meaning |
| --- | --- |
| `PI_WEB_X_PASSWORD` | HTTP Basic Auth password before browser authentication is initialized; username is always `pi` |
| `PI_WEB_X_TRUSTED_PROXY=true` | Use the first forwarded client IP for login rate-limit buckets |

Browser Web Access Authentication is the normal interactive path. Before setup, Basic Auth checks `PI_WEB_X_PASSWORD`; after setup, Basic Auth checks the stored browser password. Do not expose either over unencrypted public HTTP. Forwarded scheme evidence is used for Secure Cookie behavior independently of `PI_WEB_X_TRUSTED_PROXY`, so a reverse proxy must overwrite forwarded headers and prevent direct untrusted access to the backend. Enable `PI_WEB_X_TRUSTED_PROXY` only when that proxy boundary is enforced and forwarded client addresses are trustworthy.

### Updates and assets

| Variable | Meaning |
| --- | --- |
| `PI_WEB_X_SKIP_VERSION_CHECK=1` | Disable the app update endpoint/check |
| `PI_WEB_X_UPDATE_URL` | Explicit version metadata URL; disables default source fallback |
| `PI_WEB_X_RELEASE_BASE` | Base URL for release downloads |
| `PI_WEB_X_ASSETS_URL` | Asset archive mirror URL; may contain a `{version}` placeholder |
| `PI_WEB_X_ASSETS_FORCE=1` | Retry asset bootstrap immediately after a previous failure |
| `PI_WEB_X_ASSETS_COOLDOWN_MS` | Override the default 24-hour asset retry cooldown |

Mirror endpoints must be protected with the same integrity and access controls as the official release source. Executable and asset downloads remain checksum/version validated.

`PI_WEB_X_AUTH_CONFIG_PATH` exists for isolated tests and controlled embedding. Normal deployments should use the default `~/.pi-web-x/auth/pi-web-auth.json` location.

## Configuration locations

| Data | Default location |
| --- | --- |
| Pi sessions, models, credentials, plugins, skills, prompts, themes | `~/.pi/agent` |
| Pi Web X installation and directory assets on macOS/Linux | `~/.pi-web-x` |
| Browser password-verification state | `~/.pi-web-x/auth/pi-web-auth.json` |
| Persisted browser session hashes/metadata | `~/.pi-web-x/auth/pi-web-sessions.json` |
| Linux systemd environment snapshot | `~/.pi-web-x/env` |
| macOS service logs | `~/Library/Logs/pi-web-x.{out,err}.log` |
| Windows service log | `%USERPROFILE%\.pi-web-x\service.log` |

Pi Web X-specific data is never written into `~/.pi/agent`. Conversely, shared pi data must not be copied into `~/.pi-web-x`.

## Project command environment

The server's Host Runtime Environment and commands run for a selected project are separate trust domains. Built-in project shells remove host-only values such as `PI_WEB_X_*`, `BUN_*`, `PORT`, `NODE_ENV`, and legacy `NEXT_*` before running a project command. Explicit variables provided by the project command still take effect.

This means server passwords and mirror configuration should not appear in `git`, package-manager, or Agent shell subprocesses. See [ADR 0001](../adr/0001-isolate-project-command-environments.md).

## Precedence and persistence

- CLI options override environment defaults for the current run.
- `service install` snapshots port, hostname, and Basic Auth configuration at installation time; changing the current shell later does not alter an installed service.
- Browser settings are stored by the application and are separate from process environment variables.
- Pi Web X does not read legacy `PI_WEB_*` variables or `pi-web:*` browser storage.

See [system service registration](./system-service.md) for platform-specific persistence.
