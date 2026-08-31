# PWA companion

[Documentation index](../README.md) · [Authentication](./authentication.md) · [ADR 0007](../adr/0007-mobile-pwa-companion-boundary.md)

Pi Web X can be installed by supported browsers as a Progressive Web App. The PWA is a companion to a running Pi Web X service, not an offline Agent runtime or a native application replacement.

## What the PWA does

- provides a touch-oriented view of conversations and session management;
- reconnects to Agent event streams served by the running host;
- lets users review files and Agent changes through the same server APIs as desktop;
- can show task-completion notifications after explicit user permission;
- offers an update action when a new Service Worker is ready.

## What it deliberately does not do

- execute an Agent while the server is offline;
- cache session history or provider credentials for offline reading;
- queue prompts, file writes, or other mutations while disconnected;
- weaken server-side file, command, Host, Origin, or authentication checks;
- claim that an HTTP/LAN connection is secure merely because the app is installable.

Unsent drafts are scoped to the current browser session. They are not durable offline work queues.

## Secure-context requirements

Browsers generally require a secure context for installation, Service Workers, and Push. `localhost` is treated as a secure context by major browsers for development. LAN hostnames and IP addresses should be served through HTTPS.

If the current browser lacks a required capability, Pi Web X remains a responsive web application and displays a factual limitation notice. It does not attempt to infer that a private IP address is safe for public exposure.

## Installing

1. Start Pi Web X and log in.
2. Open the site in a browser that supports PWA installation.
3. Use the browser's Install/Add to Home Screen action.
4. Keep the Pi Web X service reachable whenever Agent or project access is needed.

Browser menus and installation criteria vary. If installation is unavailable, confirm HTTPS/localhost, manifest availability, Service Worker support, and that the browser is not in a restricted private mode.

## Updates

A newly downloaded Service Worker waits until the user accepts the update. This avoids replacing the active application while a draft or Agent run is visible. Save or submit current work, then use the in-app update action.

Application binary updates remain separate and use `pi-web-x update` or a new Release download. Updating only the Service Worker does not replace the native server executable.

## Notifications

Task-completion notifications are opt-in. When no app window is visible, the Service Worker can show a system notification containing a localized status and session name. Notification payloads do not contain conversation history, prompts, credentials, or tool output.

If permission is denied or Push/Notification APIs are unavailable, the application continues with in-page status indicators. Revoking notification permission does not affect Agent execution.

## Security boundary

Mobile and desktop clients share the same server-side authorization and project-access rules. The PWA does not introduce mobile-only bypasses or weaker confirmation policy. For remote access, use browser authentication, HTTPS, and a trusted VPN or hardened reverse proxy as described in [SECURITY.md](../../SECURITY.md).
