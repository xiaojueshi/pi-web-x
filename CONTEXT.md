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

**Idle Session Reaping**:
A service-level lifecycle policy that releases an inactive in-memory AgentSession while preserving its persisted Pi session history for later restoration.
_Avoid_: session deletion, timeout logout, garbage collection

**Extension Liveness**:
The declaration that extension-owned background work for a Web Session remains active and must prevent Idle Session Reaping.
_Avoid_: browser keepalive, SSE heartbeat, agent streaming

**Built-in Inline Subagent**:
The Pi Web X-operated subagent extension whose lifecycle and child sessions are part of Pi Web X.
_Avoid_: SDK built-in subagent, user-installed subagent

**External Subagent Extension**:
A subagent implementation installed and managed by the user through the plugin system, independently of the Built-in Inline Subagent.
_Avoid_: built-in subagent, Pi Web X subagent

**Subagent Profile**:
A named delegation configuration that defines a subagent's instructions, permitted tools, and execution defaults. Profiles have a source scope; built-in and workspace profiles are read-only, while global and project profiles are user-managed.
_Avoid_: plugin, session, model preset

**Subagent Observation View**:
A parent-session-scoped view of Built-in Inline Subagent sessions that reports their running and total counts, status, messages, and tool results.
_Avoid_: global job queue, external plugin dashboard

**Subagent Settings**:
An always-available settings area for the Built-in Inline Subagent, its activation choice, and its profiles. Project-scoped sources become available when a project is open.
_Avoid_: external plugin settings, project-only settings

**Subagent Profile Precedence**:
The rule that resolves same-named profiles by source priority: project, workspace, global, then built-in. The effective profile and every shadowed source remain visible.
_Avoid_: merge, duplicate profile error

**Read-only Subagent Observation**:
The rule that a human user may inspect a Built-in Inline Subagent session but cannot send messages or otherwise mutate it. Direct write requests are rejected; parent-agent orchestration remains separate.
_Avoid_: inactive session, user-controlled subagent

**Parent Abort Cascade**:
The rule that stopping a parent Agent stops every active Built-in Inline Subagent belonging to that parent, while preserving their aborted histories for observation.
_Avoid_: session deletion, completed-session removal

**Parent Session Deletion Cascade**:
The rule that deleting a parent Web Session deletes its persisted Built-in Inline Subagent descendants as one file-level transaction. A parent with a running descendant is not deletable; ordinary fork children remain independent and are re-parented or de-parented.
_Avoid_: Parent Abort Cascade, reparented subagent, best-effort deletion

**Session Deletion Preview**:
A short-lived, read-only description of a Parent Session Deletion Cascade, including descendant counts, running state, and the confirmation token that binds user consent to that exact session tree.
_Avoid_: delete request, cached session list, deletion authorization

**Selected Session Lease**:
A short-lived browser-observation claim that preserves the already-live AgentSession of the chat currently selected in a browser. It is renewed explicitly and never starts a dormant AgentSession.
_Avoid_: Extension Liveness, Web Session, SSE heartbeat, authentication keepalive

**Repository-scoped Subagent Profile**:
A workspace or project profile supplied by the opened repository. It is visible but unavailable to the Built-in Inline Subagent until that project is trusted.
_Avoid_: global profile, user profile

**Project Trust Prompt**:
The one-time confirmation shown when a session from an untrusted project is first selected during a browser visit. Declining leaves a persistent restricted-functionality notice and a way to trust the project later.
_Avoid_: per-session trust, repeated modal

**Foreground Subagent Delegation**:
A delegation mode in which the parent Agent waits for the subagent result and continues the same Agent turn from that tool result.
_Avoid_: background delegation, parent termination

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
