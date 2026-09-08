import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, test } from "bun:test";

const cleanups: (() => Promise<void>)[] = [];
beforeEach(() => {
  cleanups.length = 0;
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const { POST } = await import("../../../../../app/api/agent/[id]/route.ts");
const { PATCH: patchSession, DELETE: deleteSession } = await import(
  "../../../../../app/api/sessions/[id]/route.ts"
);
const { POST: autoNameSession } = await import(
  "../../../../../app/api/sessions/[id]/auto-name/route.ts"
);
const { cacheSessionPath, invalidateSessionPathCache } = await import(
  "../../../../../lib/session-reader.ts"
);

async function createSubagentSession() {
  const directory = await mkdtemp(join(tmpdir(), "pi-web-x-agent-readonly-"));
  const id = `subagent-readonly-${Date.now()}`;
  const path = join(directory, `${id}.jsonl`);
  await writeFile(
    path,
    [
      JSON.stringify({
        type: "session",
        version: 3,
        id,
        timestamp: "2026-01-01T00:00:00.000Z",
        cwd: directory,
      }),
      JSON.stringify({
        type: "custom",
        id: "subagent-meta",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        customType: "pi-web-x:subagent",
        data: {
          version: 1,
          parentSessionId: "parent",
          parentSessionPath: join(directory, "parent.jsonl"),
          parentToolCallId: "tool",
          profile: "explore",
          description: "Inspect files",
          task: "Inspect files",
          runInBackground: false,
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      }),
      "",
    ].join("\n"),
  );
  cacheSessionPath(id, path);
  cleanups.push(async () => {
    invalidateSessionPathCache(id);
    await rm(directory, { recursive: true, force: true });
  });
  return { id };
}

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/agent/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("session routes reject all writes to a persisted subagent session", async () => {
  const { id } = await createSubagentSession();
  const context = { params: Promise.resolve({ id }) };

  for (const request of [
    new Request(`http://localhost/api/sessions/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "renamed" }),
    }),
    new Request(`http://localhost/api/sessions/${id}`, { method: "DELETE" }),
    new Request(`http://localhost/api/sessions/${id}/auto-name`, {
      method: "POST",
    }),
  ]) {
    const response =
      request.method === "PATCH"
        ? await patchSession(request, context)
        : request.url.endsWith("/auto-name")
          ? await autoNameSession(request, context)
          : await deleteSession(request, context);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Subagent sessions are read-only",
      code: "subagent_read_only",
    });
  }
});

test("agent route rejects all writes to a persisted subagent session", async () => {
  const { id } = await createSubagentSession();
  const context = { params: Promise.resolve({ id }) };

  for (const body of [
    { type: "prompt", message: "continue" },
    { type: "steer", message: "focus" },
    { type: "abort" },
    { type: "set_model", provider: "test", modelId: "model" },
    { type: "set_tools", toolNames: ["read"] },
    { type: "fork" },
  ]) {
    const response = await POST(request(body), context);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: "Subagent sessions are read-only",
      code: "subagent_read_only",
    });
  }
});
