# Installation and updates

[Documentation index](../README.md) · [Configuration](./configuration.md) · [Security policy](../../SECURITY.md)

Pi Web X is primarily distributed as eight platform-native executables. The executable embeds Bun and does not require a system Node.js or Bun installation.

## Supported release targets

| Operating system | Architecture | Artifact family |
| --- | --- | --- |
| macOS | x64, arm64 | `pi-web-x-darwin-*` |
| Linux glibc | x64, arm64 | `pi-web-x-linux-*` |
| Linux musl | x64, arm64 | `pi-web-x-linux-*-musl` |
| Windows | x64, arm64 | `pi-web-x-windows-*.exe` |

## Install script

macOS or Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.sh | sh
```

Options:

```text
-d, --dir <dir>      Installation root (default: ~/.pi-web-x)
-v, --version <ver>  Install a release such as v0.9.3
-f, --force          Reinstall the same version
-n, --dry-run        Print the selected artifact without downloading
-h, --help           Show help
```

Windows PowerShell 5.1 or later:

```powershell
irm https://raw.githubusercontent.com/xiaojueshi/pi-web-x/main/install.ps1 | iex
```

Both scripts detect the target, download the executable and `SHA256SUMS`, require a matching checksum entry, and install for the current user. A missing entry or mismatched hash aborts installation. Directory assets are fetched by the executable on first startup or installed manually; the installers do not download the asset archive.

On macOS/Linux the installation root is `~/.pi-web-x` and `~/.local/bin/pi-web-x` is a symlink. Windows uses `%USERPROFILE%\pi-web-x` and adds that directory to the user PATH.

For an old macOS/Linux `~/pi-web-x` installation, the default installer migrates that directory before writing the new executable when `~/.pi-web-x` is absent or empty. If the target already contains data, migration is skipped with a warning; merge or back up the legacy directory manually. A custom installation directory is never rewritten into a dot-prefixed path.

## Verify a manual download

Download the matching platform artifact and `SHA256SUMS` from the same release. Verify only that artifact's checksum, then rename it to the command name. For Linux x64 glibc:

```bash
grep ' pi-web-x-linux-x64$' SHA256SUMS | sha256sum -c -
mv pi-web-x-linux-x64 pi-web-x
chmod +x ./pi-web-x
./pi-web-x --version
./pi-web-x --help
```

On macOS, use `shasum -a 256 -c` with the matching Darwin line; on Windows, use the platform checksum tool and retain the `.exe` suffix. Do not combine an executable and checksum file from different releases, and do not bypass a failed checksum.

## Built-in asset archive

The pi SDK expects directory assets such as themes and export templates beside the executable. Releases therefore include `pi-web-x-assets-<version>.tar.gz`. Startup verifies and installs those assets automatically.

For an offline environment:

```bash
pi-web-x assets status
pi-web-x assets install /path/to/pi-web-x-assets-<version>.tar.gz
```

Set `PI_WEB_X_ASSETS_URL` to an approved mirror when direct GitHub access is unavailable. Asset bootstrap failure does not block the web server; theme initialization has a minimal fallback, but features that need a missing directory can remain unavailable until the archive is installed.

## Update

```bash
pi-web-x update --check
pi-web-x update
pi-web-x update --force
```

An update downloads the selected executable, verifies `SHA256SUMS`, keeps a backup, replaces the binary atomically where the platform permits it, and restores a registered system service. If service recovery fails, the verified new binary and backup remain available and the command exits non-zero.

By default, version checks fall back from the GitHub API to jsDelivr when the GitHub API is rate-limited or unavailable. `PI_WEB_X_UPDATE_URL` selects one explicit metadata endpoint; `PI_WEB_X_RELEASE_BASE` selects a release mirror. See [configuration](./configuration.md) for mirror variables.

## Runtime requirements

- **Release executable:** no Bun or Node.js installation.
- **Source checkout:** Bun 1.4.0 for install, development, tests, and builds.
- **npm launcher:** requires Node.js because `bin/pi-web-x.js` is a launcher for an already packaged native executable. It is not the application server.
- **Feature tools:** `git`, `npm`, or `npx` are required only when a selected worktree/plugin/skill operation invokes them.

See [Bun and Node.js boundaries](../development/bun-and-node.md) for the TypeScript and runtime model.

## Troubleshooting

- **Command not found:** ensure `~/.local/bin` (macOS/Linux) or the Windows installation directory is on PATH.
- **Checksum mismatch:** delete the download and retrieve both files from the same release or mirror; never bypass verification.
- **macOS security warning:** release signing/notarization status is documented in the release notes. Do not remove quarantine from an unverified file.
- **Assets unavailable:** run `pi-web-x assets status`, then install the matching archive manually.
- **Port already in use:** select another port with `-p` or stop the process using the configured port.
