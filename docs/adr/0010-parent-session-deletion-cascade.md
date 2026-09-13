# Delete Built-in Inline Subagent descendants with their parent session

Deleting a Parent Web Session deletes its persisted Built-in Inline Subagent descendants rather than re-parenting them, because those children are parent-scoped, read-only observation resources rather than independent user branches. The browser obtains a short-lived Session Deletion Preview and must return its opaque token; the server recomputes and matches the exact tree before mutation. A running descendant causes a 409 refusal with no abort and no file mutation, while ordinary fork children remain independent and are atomically re-parented or de-parented.

Status: accepted

## Considered Options

- Re-parent Built-in Inline Subagent children to the nearest surviving ancestor. Rejected because it breaks the parent-scoped observation model and requires rewriting active child JSONL files.
- Abort running descendants and then delete. Rejected for normal deletion because aborting a model/tool run is irreversible, so a later filesystem failure cannot be fail-closed.
- Delete as files are discovered and report residual failures. Rejected because it can leave a partially removed session tree.

## Consequences

The deletion path backs up every affected JSONL before mutation and restores all files if a re-parent or unlink operation fails. Confirmation cannot be bypassed, and the client receives every deleted session ID so it can clear a selected descendant as well as the requested parent.
