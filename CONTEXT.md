# Pi Web X

Pi Web hosts coding-agent sessions for user-selected projects while keeping the web server's runtime concerns separate from project work.

## Language

**Host Runtime Environment**:
The environment owned by the Pi Web server and its framework runtime.
_Avoid_: Project environment, shell environment

**Project Command Environment**:
The environment presented to a command that Pi Web runs on behalf of a user-selected project.
_Avoid_: Host environment, inherited environment

**Built-in Project Shell**:
A shell entry point owned and operated by Pi Web for commands associated with a project.
_Avoid_: Extension shell, arbitrary child process

**System Service**:
An OS-managed persistent run of the Pi Web X web server — a systemd user unit, a launchd LaunchAgent, or a Windows scheduled task — that outlives the launching shell and can start at login.
_Avoid_: server, daemon, web service

**Service Command**:
The `pi-web-x service` command family that installs and uninstalls a System Service, snapshotting the web server's launch configuration at install time.
_Avoid_: daemonize flag, install flag

**Web Access Authentication**:
The password-based identity system that gates browser access to Pi Web X — first-run setup, login, logout, password change, and session revocation.
_Avoid_: login, auth, permission, access control

**Setup Token**:
A one-time 32-byte random token printed to server stderr on first startup; presenting it at the Setup page initializes the Web Access Authentication password.
_Avoid_: setup code, init token, invite code

**Web Session**:
An in-memory authenticated session created after a correct login, referenced only by a random HttpOnly cookie; invalidated by expiry or password change.
_Avoid_: token, login state, JWT

**User Data Root**:
The dot-prefixed `~/.pi-web-x/` directory that holds Pi Web X's own files — install root, authentication config, and service snapshots.
_Avoid_: ~/pi-web-x (legacy), install dir

**Basic Auth Fallback**:
The `PI_WEB_X_PASSWORD` HTTP Basic authentication path for programmatic clients (CLI, curl, tests), kept alongside the browser-facing Web Access Authentication.
_Avoid_: password auth, legacy auth

## Mobile Experience

**Mobile Companion**:
The touch-first Pi Web X experience for monitoring and continuing coding-agent work from a phone; it centers the conversation rather than recreating a desktop IDE.
_Avoid_: mobile IDE, mobile-only product

**PWA Companion**:
The installable Pi Web X browser application that accompanies a running pi-web-x service, with best-effort offline guidance and background task notifications.
_Avoid_: native app, offline agent

**Connection Safety Notice**:
A persistent, fact-based explanation of the current connection's security capabilities and limitations, especially when HTTPS, installation, or Push is unavailable.
_Avoid_: security guarantee, public-network detector
