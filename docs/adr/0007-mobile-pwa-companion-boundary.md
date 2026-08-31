# Keep the mobile PWA as a companion to the pi-web-x service

Pi Web X will provide a touch-first, installable mobile experience for conversations, session management, file review, and agent-change review, while the pi-web-x service remains responsible for agent execution and protected project access. The PWA does not cache session history, queue writes, execute agents offline, or add a native-app wrapper: offline mode is explicit guidance, and background completion notifications contain only a session name and status. This deliberately trades offline independence for the existing security boundary around project data and command execution.

## Considered Options

- Cache session content and queue operations for a fully offline application.
- Treat the mobile UI as a reduced desktop IDE with a full code editor.
- Provide a companion experience backed by the running pi-web-x service.

## Consequences

A secure context remains necessary for installation and Push, but HTTP access degrades to a usable responsive web page with an explicit capability and connection-safety notice. Mobile write operations retain the same product behavior and server-side safeguards as desktop; no mobile-only confirmation policy is introduced.
