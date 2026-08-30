# Register pi-web-x as a per-user OS service through a `service` CLI

Pi Web X ships a `service install` / `service uninstall` command family that registers the web server as an operating-system service on the user's platform, replacing manual unit-file authoring for the common "run and start at login" case.

The service always runs as the installing user, never as root: Linux systemd installs a per-user unit (`~/.config/systemd/user/pi-web-x.service`) enabled via `systemctl --user` plus `loginctl enable-linger` for login-less autostart; macOS installs a per-user LaunchAgent (`~/Library/LaunchAgents/com.pi-web-x.plist`). This preserves the invariant that Pi data lives in the caller's `~/.pi/agent` and that the server only listens on loopback unless explicitly widened.

Windows registers a Task Scheduler `ONLOGON` task instead of a native Windows service because Bun-compiled executables cannot implement the SCM service-control handshake (oven-sh/bun#25824 is an open feature request), and `schtasks` needs no third-party wrapper such as NSSM. Consequently Windows gets login-triggered autostart without crash-restart semantics, and a snapshotted `PI_WEB_X_PASSWORD` appears in plaintext in the task definition — the installer warns about this.

Linux without systemd (musl-Alpine/OpenRC and friends) is deliberately unsupported: the installer errors with manual guidance. No other per-user service manager is common enough to justify the platform glue.

Configuration is snapshotted at install time — a 0600 EnvironmentFile on Linux, plist `ProgramArguments`/`EnvironmentVariables` on macOS, task arguments on Windows — so `pi-web-x service install -p 8080` installs the state the caller asked for, and users can edit the snapshot without touching the service definition. Re-install is an idempotent overwrite guarded by an interactive confirm (or `--force`).

Status: accepted
