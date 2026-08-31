# Unify Pi Web X user data under a dot-prefixed root `~/.pi-web-x/`

All Pi Web X custom paths converge on `~/.pi-web-x/`: the install root (binary + built-in assets + export-html), the authentication config (`auth/pi-web-auth.json`), and the systemd `EnvironmentFile` snapshot. The legacy `~/pi-web-x` install root is deprecated; `install.sh` and `pi-web-x update` detect it and migrate automatically (whole-directory move, then rebuild the `~/.local/bin` symlink). Startup never touches the filesystem, and a user-supplied `--dir` is honored as-is without adding a dot.

OS-convention locations stay where they are: `~/.config/systemd/user/pi-web-x.service`, `~/Library/Logs/pi-web-x.*.log`, and `~/Library/LaunchAgents/com.pi-web-x.plist`. A systemd service snapshot referencing the old env path is not rewritten automatically; `update` warns the user to re-run `service install`.

Status: accepted
