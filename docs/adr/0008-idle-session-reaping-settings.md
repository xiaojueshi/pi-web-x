# Idle Session Reaping is a Pi Web X service setting, not an environment variable

Pi Web X releases inactive in-memory AgentSessions while retaining their persisted Pi session history. We make this a global setting persisted under the User Data Root and controlled from Settings → General: users can disable reaping or set a five-to-1,440-minute timeout, with a default of ten minutes. We deliberately reject an environment variable because the setting is an administrator-visible lifecycle preference rather than deployment wiring; extension-owned background work registers Extension Liveness and always prevents reaping.

Status: accepted

## Considered Options

- Environment variable with settings-panel fallback — rejected because two sources of truth would make the active policy non-obvious.
- Per-project or per-browser preference — rejected because an in-memory AgentSession belongs to the service process, not either scope.
