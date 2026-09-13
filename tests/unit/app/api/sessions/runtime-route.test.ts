import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import { afterEach, beforeEach } from "bun:test";
import type { SessionDeletionFileOperations } from "../../../../../lib/session-deletion.ts";

// node:test t.after 的 Bun 原生替代：测试开始前清空、结束后按 LIFO 执行清理。
const tcompatCleanups: (() => void)[] = [];
beforeEach(() => {
  tcompatCleanups.length = 0;
});
afterEach(async () => {
  for (const fn of tcompatCleanups.splice(0).reverse()) await fn();
});

const listRoute = await readFile(
  new URL("../../../../../app/api/sessions/route.ts", import.meta.url),
  "utf8",
);
const detailRoute = await readFile(
  new URL("../../../../../app/api/sessions/[id]/route.ts", import.meta.url),
  "utf8",
);
const contextRoute = await readFile(
  new URL(
    "../../../../../app/api/sessions/[id]/context/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const stateRoute = await readFile(
  new URL(
    "../../../../../app/api/sessions/[id]/state/route.ts",
    import.meta.url,
  ),
  "utf8",
);
const { DELETE: deleteSession, GET: getSessionDetail } = await import(
  "../../../../../app/api/sessions/[id]/route.ts"
);
const { deleteSessionWithPreview, previewSessionDelete } = await import(
  "../../../../../lib/session-deletion.ts"
);
const { GET: getSessionState } = await import(
  "../../../../../app/api/sessions/[id]/state/route.ts"
);
const { cacheSessionPath, invalidateSessionPathCache } = await import(
  "../../../../../lib/session-reader.ts"
);

test("session listing merges live registry snapshots and honors force refresh", () => {
  assert.match(listRoute, /\.get\("force"\) === "1"/);
  assert.match(listRoute, /listAllSessions\(\{ force \}\)/);
  assert.match(listRoute, /attachSessionProjectInfo\(getRpcSessionInfos\(\)\)/);
  assert.match(
    listRoute,
    /mergeSessionLists\(persistedSessions, runtimeSessions\)/,
  );
  assert.match(listRoute, /"Cache-Control": "no-store"/);
});

test("session reads use the live SessionManager before requiring a JSONL path", () => {
  for (const source of [detailRoute, contextRoute]) {
    const liveLookup = source.indexOf("getRpcSession(id)");
    const pathLookup = source.indexOf("resolveSessionPath(id)");
    assert.ok(liveLookup >= 0);
    assert.ok(pathLookup > liveLookup);
    assert.match(
      source,
      /liveRpc\?\.inner\.sessionManager \?\? SessionManager\.open/,
    );
  }
});

test("live agent state is available before the session file is persisted", () => {
  const liveLookup = stateRoute.indexOf("getRpcSession(id)");
  const pathLookup = stateRoute.indexOf("resolveSessionPath(id)");
  assert.ok(liveLookup >= 0);
  assert.ok(pathLookup > liveLookup);
  assert.match(stateRoute, /if \(rpc\?\.isAlive\(\)\)/);
});

test("deleting a parent recursively deletes its built-in inline subagent descendants", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-x-delete-reparent-"));
  const grandparentPath = join(dir, "grandparent.jsonl");
  const parentPath = join(dir, "parent.jsonl");
  const childPath = join(dir, "child.jsonl");
  const parentId = "delete-reparent-parent";
  const header = (id, parentSession) =>
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: dir,
      ...(parentSession ? { parentSession } : {}),
    });
  await writeFile(
    grandparentPath,
    `${header("delete-reparent-grandparent")}\n`,
  );
  await writeFile(parentPath, `${header(parentId, grandparentPath)}\n`);
  await writeFile(
    childPath,
    [
      header("delete-reparent-child", parentPath),
      JSON.stringify({
        type: "custom",
        customType: "pi-web-x:subagent",
        id: "meta",
        parentId: null,
        timestamp: "2026-01-01T00:00:00.000Z",
        data: {
          version: 1,
          parentSessionId: parentId,
          parentSessionPath: parentPath,
          profile: "Explore",
          description: "Inspect parser",
        },
      }),
      "",
    ].join("\n"),
  );
  cacheSessionPath(parentId, parentPath);
  tcompatCleanups.push(async () => {
    invalidateSessionPathCache(parentId);
    await rm(dir, { recursive: true, force: true });
  });

  const preview = await previewSessionDelete(parentId);
  const response = await deleteSession(
    new Request(`http://localhost/api/sessions/${parentId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: preview.token }),
    }),
    { params: Promise.resolve({ id: parentId }) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    (await response.json()).deletedSessionIds.sort(),
    ["delete-reparent-child", parentId].sort(),
  );
  await assert.rejects(readFile(parentPath), { code: "ENOENT" });
  await assert.rejects(readFile(childPath), { code: "ENOENT" });
});

test("deleting a session whose parent file is missing deparents its children", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-x-delete-orphan-parent-"));
  const missingParentPath = join(dir, "missing-parent.jsonl");
  const targetPath = join(dir, "target.jsonl");
  const childPath = join(dir, "child.jsonl");
  const targetId = "delete-orphan-target";
  const header = (id, parentSession) =>
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      timestamp: "2026-01-01T00:00:00.000Z",
      cwd: dir,
      ...(parentSession ? { parentSession } : {}),
    });
  await writeFile(targetPath, `${header(targetId, missingParentPath)}\n`);
  await writeFile(
    childPath,
    [header("delete-orphan-child", targetPath), ""].join("\n"),
  );
  cacheSessionPath(targetId, targetPath);
  tcompatCleanups.push(async () => {
    invalidateSessionPathCache(targetId);
    await rm(dir, { recursive: true, force: true });
  });

  const preview = await previewSessionDelete(targetId);
  const response = await deleteSession(
    new Request(`http://localhost/api/sessions/${targetId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: preview.token }),
    }),
    { params: Promise.resolve({ id: targetId }) },
  );

  assert.equal(response.status, 200);
  const [childHeaderLine] = (await readFile(childPath, "utf8"))
    .trim()
    .split("\n");
  assert.equal(JSON.parse(childHeaderLine).parentSession, undefined);
});

test("delete requires the exact preview token and makes no changes on rejection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-x-delete-token-"));
  const path = join(dir, "target.jsonl");
  const id = "delete-token-target";
  await writeFile(
    path,
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      cwd: dir,
      timestamp: "2026-01-01T00:00:00.000Z",
    }) + "\n",
  );
  cacheSessionPath(id, path);
  tcompatCleanups.push(async () => {
    invalidateSessionPathCache(id);
    await rm(dir, { recursive: true, force: true });
  });

  const preview = await previewSessionDelete(id);
  const response = await deleteSession(
    new Request(`http://localhost/api/sessions/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: `${preview.token}-wrong` }),
    }),
    { params: Promise.resolve({ id }) },
  );
  assert.equal(response.status, 409);
  assert.equal(
    await readFile(path, "utf8"),
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      cwd: dir,
      timestamp: "2026-01-01T00:00:00.000Z",
    }) + "\n",
  );
});

test("a failed descendant unlink restores the complete deletion set", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-x-delete-rollback-"));
  const parentPath = join(dir, "parent.jsonl");
  const childPath = join(dir, "child.jsonl");
  const parentId = "delete-rollback-parent";
  const childId = "delete-rollback-child";
  const header = (id, parentSession) =>
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      cwd: dir,
      timestamp: "2026-01-01T00:00:00.000Z",
      ...(parentSession ? { parentSession } : {}),
    });
  const parentSource = `${header(parentId)}\n`;
  const childSource = `${header(childId, parentPath)}\n${JSON.stringify({
    type: "custom",
    customType: "pi-web-x:subagent",
    id: "meta",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    data: {
      version: 1,
      parentSessionId: parentId,
      parentSessionPath: parentPath,
    },
  })}\n`;
  await writeFile(parentPath, parentSource);
  await writeFile(childPath, childSource);
  cacheSessionPath(parentId, parentPath);
  tcompatCleanups.push(async () => {
    invalidateSessionPathCache(parentId);
    await rm(dir, { recursive: true, force: true });
  });

  const preview = await previewSessionDelete(parentId);
  const operations: SessionDeletionFileOperations = {
    exists: existsSync,
    read: (path) => readFileSync(path, "utf8"),
    write: (path, content, options) =>
      writeFileSync(
        path,
        content,
        options?.exclusive ? { flag: "wx" } : undefined,
      ),
    unlink: (path) => {
      if (path === parentPath) throw new Error("injected unlink failure");
      unlinkSync(path);
    },
  };

  await assert.rejects(
    deleteSessionWithPreview(parentId, preview.token, operations),
    /injected unlink failure/,
  );
  assert.equal(await readFile(parentPath, "utf8"), parentSource);
  assert.equal(await readFile(childPath, "utf8"), childSource);
  assert.equal(
    readdirSync(dir).some((name) => name.includes("pi-web-x-delete-backup")),
    false,
  );
});

test("a failed restore retains every operation backup for manual recovery", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-x-delete-restore-"));
  const parentPath = join(dir, "parent.jsonl");
  const childPath = join(dir, "child.jsonl");
  const parentId = "delete-restore-parent";
  const childId = "delete-restore-child";
  const header = (id, parentSession) =>
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      cwd: dir,
      timestamp: "2026-01-01T00:00:00.000Z",
      ...(parentSession ? { parentSession } : {}),
    });
  const parentSource = `${header(parentId)}\n`;
  const childSource = `${header(childId, parentPath)}\n${JSON.stringify({
    type: "custom",
    customType: "pi-web-x:subagent",
    id: "meta",
    parentId: null,
    timestamp: "2026-01-01T00:00:00.000Z",
    data: {
      version: 1,
      parentSessionId: parentId,
      parentSessionPath: parentPath,
    },
  })}\n`;
  await writeFile(parentPath, parentSource);
  await writeFile(childPath, childSource);
  cacheSessionPath(parentId, parentPath);
  tcompatCleanups.push(async () => {
    invalidateSessionPathCache(parentId);
    await rm(dir, { recursive: true, force: true });
  });

  const preview = await previewSessionDelete(parentId);
  let restoring = false;
  const operations: SessionDeletionFileOperations = {
    exists: existsSync,
    read: (path) => readFileSync(path, "utf8"),
    write: (path, content, options) => {
      if (restoring && path === childPath) {
        throw new Error("injected restore failure");
      }
      writeFileSync(
        path,
        content,
        options?.exclusive ? { flag: "wx" } : undefined,
      );
    },
    unlink: (path) => {
      if (path === parentPath) {
        restoring = true;
        throw new Error("injected unlink failure");
      }
      unlinkSync(path);
    },
  };

  await assert.rejects(
    deleteSessionWithPreview(parentId, preview.token, operations),
    /restoration is incomplete/,
  );
  assert.equal(existsSync(childPath), false);
  assert.equal(await readFile(parentPath, "utf8"), parentSource);
  const backups = readdirSync(dir).filter((name) =>
    name.includes("pi-web-x-delete-backup"),
  );
  assert.equal(backups.length, 2);
  assert.ok(backups.some((name) => name.startsWith("parent.jsonl.")));
  assert.ok(backups.some((name) => name.startsWith("child.jsonl.")));
});

test("a mutation after backup creation is rejected before unlink and restored", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-x-delete-race-"));
  const path = join(dir, "parent.jsonl");
  const id = "delete-race-parent";
  const source = `${JSON.stringify({
    type: "session",
    version: 3,
    id,
    cwd: dir,
    timestamp: "2026-01-01T00:00:00.000Z",
  })}\n`;
  await writeFile(path, source);
  cacheSessionPath(id, path);
  tcompatCleanups.push(async () => {
    invalidateSessionPathCache(id);
    await rm(dir, { recursive: true, force: true });
  });

  const preview = await previewSessionDelete(id);
  let mutated = false;
  const operations: SessionDeletionFileOperations = {
    exists: existsSync,
    read: (target) => readFileSync(target, "utf8"),
    write: (target, content, options) =>
      writeFileSync(
        target,
        content,
        options?.exclusive ? { flag: "wx" } : undefined,
      ),
    unlink: (target) => unlinkSync(target),
    beforeDelete: (target) => {
      if (!mutated && target === path) {
        mutated = true;
        writeFileSync(path, `${source}{"late":true}\n`);
      }
    },
  };

  await assert.rejects(
    deleteSessionWithPreview(id, preview.token, operations),
    (error) => (error as { status?: number }).status === 409,
  );
  assert.equal(await readFile(path, "utf8"), source);
});

test("a running inline descendant returns 409 before any file changes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-x-delete-running-"));
  const parentPath = join(dir, "parent.jsonl");
  const childPath = join(dir, "child.jsonl");
  const parentId = "delete-running-parent";
  const childId = "delete-running-child";
  const header = (id, parentSession) =>
    JSON.stringify({
      type: "session",
      version: 3,
      id,
      cwd: dir,
      timestamp: "2026-01-01T00:00:00.000Z",
      ...(parentSession ? { parentSession } : {}),
    });
  await writeFile(parentPath, `${header(parentId)}\n`);
  await writeFile(
    childPath,
    `${header(childId, parentPath)}\n${JSON.stringify({
      type: "custom",
      customType: "pi-web-x:subagent",
      id: "meta",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        version: 1,
        parentSessionId: parentId,
        parentSessionPath: parentPath,
      },
    })}\n`,
  );
  cacheSessionPath(parentId, parentPath);
  const previousRegistry = globalThis.__piSessions;
  globalThis.__piSessions = new Map([
    [childId, { isAlive: () => true, isRunning: () => true }],
  ]);
  tcompatCleanups.push(async () => {
    globalThis.__piSessions = previousRegistry;
    invalidateSessionPathCache(parentId);
    await rm(dir, { recursive: true, force: true });
  });

  const preview = await previewSessionDelete(parentId);
  const response = await deleteSession(
    new Request(`http://localhost/api/sessions/${parentId}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: preview.token }),
    }),
    { params: Promise.resolve({ id: parentId }) },
  );
  assert.equal(response.status, 409);
  assert.equal(await readFile(parentPath, "utf8"), `${header(parentId)}\n`);
  assert.equal(
    await readFile(childPath, "utf8"),
    `${header(childId, parentPath)}\n${JSON.stringify({
      type: "custom",
      customType: "pi-web-x:subagent",
      id: "meta",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        version: 1,
        parentSessionId: parentId,
        parentSessionPath: parentPath,
      },
    })}\n`,
  );
});

test("live detail and state routes work without a persisted JSONL file", async () => {
  const previousRegistry = globalThis.__piSessions;
  const id = "live-route-test";
  const timestamp = "2026-08-12T01:02:03.000Z";
  const entry = {
    type: "message",
    id: "u1",
    parentId: null,
    timestamp,
    message: { role: "user", content: "hello live" },
  };
  const sessionManager = {
    getHeader: () => ({ type: "session", id, cwd: "/tmp", timestamp }),
    getEntries: () => [entry],
    getLeafId: () => entry.id,
    getTree: () => [],
    getSessionName: () => undefined,
    getSessionFile: () =>
      `/tmp/pi-web-x-live-route-not-persisted-${process.pid}.jsonl`,
  };
  globalThis.__piSessions = new Map([
    [
      id,
      {
        isAlive: () => true,
        isRunning: () => true,
        inner: { sessionManager },
        sessionFile: sessionManager.getSessionFile(),
        sessionId: id,
        cwd: "/tmp",
        send: async () => ({ isStreaming: true }),
      },
    ],
  ]);
  tcompatCleanups.push(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const routeContext = { params: Promise.resolve({ id }) };
  const detailResponse = await getSessionDetail(
    new Request(`http://localhost/api/sessions/${id}`),
    routeContext,
  );
  const stateResponse = await getSessionState(
    new Request(`http://localhost/api/sessions/${id}/state`),
    routeContext,
  );
  const detail = await detailResponse.json();

  assert.equal(detailResponse.status, 200);
  assert.equal(detail.info.transient, true);
  assert.equal(detail.info.projectRoot, "/tmp");
  assert.equal(typeof detail.info.projectKey, "string");
  assert.deepEqual(
    detail.context.messages.map((message) => message.content),
    ["hello live"],
  );
  assert.equal(stateResponse.status, 200);
  assert.deepEqual(await stateResponse.json(), {
    running: true,
    state: { isStreaming: true },
  });
});
