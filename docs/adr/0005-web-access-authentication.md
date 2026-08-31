# Web Access Authentication: adopt the PR #289 setup-token + session system, keep Basic Auth as a programmatic fallback

Pi Web X needs a real authentication lifecycle for network-accessible deployments. Upstream PR #289 (`feat/auth-settings-center`, authored by this project's maintainer, closed unmerged) already delivered one: scrypt password hashing, a one-time setup token printed at startup, in-memory sessions behind an HttpOnly cookie, password change with full-session revocation, and login rate limiting. We adopt that system as the browser-facing authentication for Pi Web X.

Sessions are validated when an SSE stream is established and then left alone — authentication must never interrupt a running Agent session. Browser flows go through `/login` and `/setup` pages; programmatic clients (CLI, curl, tests) keep the existing `PI_WEB_X_PASSWORD` Basic Auth as a fallback instead of a second parallel password. The setup token is delivered exactly once via server stderr (option A) and never exposed over HTTP or persisted. Authentication data lives at `~/.pi-web-x/auth/pi-web-auth.json`, not in `~/.pi/agent`, which stays reserved for pi-coding-agent data.

Status: accepted
