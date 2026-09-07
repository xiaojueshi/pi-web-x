import assert from "node:assert/strict";
import { afterEach, test } from "bun:test";

const store = await import("../../../lib/plugin-update-store.ts");
const {
  clearPluginUpdateResults,
  getPluginUpdateSnapshot,
  markPluginUpdateCheckStarted,
  markPluginUpdateCheckFinished,
  mergePluginUpdateResults,
  removePluginUpdateResult,
  requestPluginUpdateCheck,
  subscribePluginUpdates,
} = store;

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  // 重置 store：逐个可能的 cwd 清理后再回退到空 cwd
  for (const cwd of ["", "/project", "/other-cwd"]) {
    clearPluginUpdateResults(cwd);
  }
});

function update(
  source: string,
  scope: "global" | "project",
  state: string,
  message?: string,
): Parameters<typeof mergePluginUpdateResults>[1][number] {
  return { source, scope, displayName: source, type: "npm", state, message };
}

test("global update store merges results and notifies subscribers", () => {
  const seen: number[] = [];
  const unsubscribe = subscribePluginUpdates(() => seen.push(seen.length + 1));

  mergePluginUpdateResults("/project", [
    update("npm:a", "global", "update-available"),
  ]);
  const snapshot = getPluginUpdateSnapshot();
  assert.equal(snapshot.cwd, "/project");
  assert.equal(snapshot.statuses["global\0npm:a"]?.state, "update-available");
  assert.ok(snapshot.checkedAt > 0);
  assert.ok(seen.length >= 1);

  unsubscribe();
  const afterCount = seen.length;
  mergePluginUpdateResults("/project", []);
  assert.equal(seen.length, afterCount); // 已取消订阅，不再收到通知
});

test("requestPluginUpdateCheck persists non-error results silently", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        updates: [
          update("npm:ok", "global", "update-available"),
          update("npm:bad", "global", "error", "offline"),
        ],
      }),
      { status: 200 },
    )) as typeof fetch;

  const updates = await requestPluginUpdateCheck("/project", { silent: true });
  assert.equal(updates.length, 2); // 原始结果完整返回
  const snapshot = getPluginUpdateSnapshot();
  assert.equal(snapshot.cwd, "/project");
  // 静默检查只保留非 error 状态
  assert.equal(snapshot.statuses["global\0npm:ok"]?.state, "update-available");
  assert.equal(snapshot.statuses["global\0npm:bad"], undefined);
  assert.equal(snapshot.checking, false);
});

test("requestPluginUpdateCheck keeps error states for manual checks", async () => {
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        updates: [update("npm:bad", "global", "error", "boom")],
      }),
      { status: 200 },
    )) as typeof fetch;

  await requestPluginUpdateCheck("/project");
  assert.equal(
    getPluginUpdateSnapshot().statuses["global\0npm:bad"]?.state,
    "error",
  );
});

test("requestPluginUpdateCheck swallows transport failures", async () => {
  globalThis.fetch = (async () => {
    throw new Error("network down");
  }) as typeof fetch;

  const updates = await requestPluginUpdateCheck("/project", { silent: true });
  assert.deepEqual(updates, []);
  assert.equal(getPluginUpdateSnapshot().checking, false);
});

test("single-key removal and cwd-scoped clearing work", () => {
  mergePluginUpdateResults("/project", [
    update("npm:a", "global", "up-to-date"),
    update("npm:b", "global", "update-available"),
  ]);

  removePluginUpdateResult("/project", "global\0npm:a");
  assert.deepEqual(Object.keys(getPluginUpdateSnapshot().statuses), [
    "global\0npm:b",
  ]);

  clearPluginUpdateResults("/other-cwd");
  assert.equal(
    getPluginUpdateSnapshot().statuses["global\0npm:b"]?.state,
    "update-available",
  );
  clearPluginUpdateResults("/project");
  assert.deepEqual(getPluginUpdateSnapshot().statuses, {});
});

test("checking markers bracket a background check", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ updates: [] }), {
      status: 200,
    })) as typeof fetch;

  markPluginUpdateCheckStarted("/project");
  assert.equal(getPluginUpdateSnapshot().checking, true);
  markPluginUpdateCheckFinished();
  assert.equal(getPluginUpdateSnapshot().checking, false);
});
