# System service registration

[Documentation index](../README.md) · [Configuration](./configuration.md) · [ADR 0004](../adr/0004-service-command.md)

`pi-web-x service` installs the web server as a per-user operating-system service. It never requires or creates a root/system-wide service.

## Commands

```bash
pi-web-x service install
pi-web-x service install -p 8080 -H 127.0.0.1
pi-web-x service install -p 8080 -H 0.0.0.0 --force
pi-web-x service uninstall
pi-web-x service --help
```

Installation snapshots the selected port, hostname, executable path, and relevant environment configuration. Reinstalling prompts before replacement unless `--force` is supplied. `--no-input` disables prompts and fails instead of waiting for input.

## Platform behavior

| Platform | Mechanism | Files and logs | Restart behavior |
| --- | --- | --- | --- |
| Linux with systemd | User unit | `~/.config/systemd/user/pi-web-x.service`, config `~/.pi-web-x/env`, logs through `journalctl --user -u pi-web-x` | systemd policy; installer attempts `loginctl enable-linger` |
| macOS | LaunchAgent | `~/Library/LaunchAgents/com.pi-web-x.plist`, logs `~/Library/Logs/pi-web-x.{out,err}.log` | `KeepAlive` restarts crashes |
| Windows | Task Scheduler `ONLOGON` task | Task `pi-web-x`, log `%USERPROFILE%\.pi-web-x\service.log` | Starts at login; no native crash-restart contract |
| Linux without systemd | Not supported | Command prints manual guidance | User chooses another service manager |

Windows uses Task Scheduler rather than the Windows Service Control Manager because Bun-compiled executables do not implement the required service-control handshake.

## Configuration snapshot

The service does not read future values from the shell that installed it. To change a snapshotted port, hostname, or password, either edit the platform configuration carefully or reinstall:

```bash
pi-web-x service install -p 30142 -H 127.0.0.1 --force
```

On Linux the environment file is created with private permissions. On Windows, a snapshotted `PI_WEB_X_PASSWORD` is stored in plaintext in the task definition; installation prints a warning. Prefer browser authentication or a protected secret injection design where possible.

## User identity and data

The service runs as the installing user so that `~/.pi/agent` sessions and credentials retain the correct ownership. Do not install it as root to serve another user's Pi data. Each OS user should install their own service.

Default loopback binding remains unchanged. Widening the service to `0.0.0.0` requires the same HTTPS/authentication/VPN protections as an interactive launch.

## Updates and path migration

`pi-web-x update` detects a registered service and attempts to restart it after replacing the executable. When migrating the old `~/pi-web-x` installation root to `~/.pi-web-x`, supported service definitions are updated to the new executable path and the Linux environment snapshot is preserved.

A service recovery failure makes the update command exit non-zero, but it does not discard the verified new executable or its backup. Inspect the platform logs, fix the service configuration, and retry.

## Troubleshooting

Linux:

```bash
systemctl --user status pi-web-x
journalctl --user -u pi-web-x
```

macOS:

```bash
launchctl print "gui/$(id -u)/com.pi-web-x"
tail -f ~/Library/Logs/pi-web-x.err.log
```

Windows:

```powershell
schtasks /Query /TN pi-web-x /V /FO LIST
Get-Content "$env:USERPROFILE\.pi-web-x\service.log" -Tail 100
```

If a service points to a missing binary, reinstall from the current executable with `--force`. Uninstalling removes only the service definition; it does not delete Pi sessions, authentication configuration, installation assets, or logs.
