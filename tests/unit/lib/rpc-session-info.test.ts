import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "bun:test";
import { afterEach, beforeEach } from "bun:test";

// node:test t.after 的 Bun 原生替代：测试开始前清空、结束后按 LIFO 执行清理。
const tcompatCleanups: (() => void)[] = [];
beforeEach(() => {
  tcompatCleanups.length = 0;
});
afterEach(async () => {
  for (const fn of tcompatCleanups.splice(0).reverse()) await fn();
});

const { getRpcSessionInfos } = await import("../../../lib/rpc-manager.ts");

function makeRuntimeSession({ id, filePath, running, entries }) {
  const timestamp = "2026-08-12T01:02:03.000Z";
  const manager = {
    getHeader: () => ({
      type: "session",
      id,
      cwd: "/tmp/runtime-cwd",
      timestamp,
    }),
    getEntries: () => entries,
    getSessionFile: () => filePath,
    getSessionName: () => undefined,
  };
  return {
    isAlive: () => true,
    isRunning: () => running,
    inner: { sessionManager: manager },
    get sessionId() {
      return id;
    },
    get sessionFile() {
      return filePath;
    },
    get cwd() {
      return "/tmp/runtime-cwd";
    },
  };
}

test("lists an accepted new prompt before its session file exists", () => {
  const previousRegistry = globalThis.__piSessions;
  const timestamp = "2026-08-12T01:02:04.000Z";
  const visible = makeRuntimeSession({
    id: "visible-runtime",
    filePath: join(tmpdir(), "pi-web-x-missing-runtime-session.jsonl"),
    running: true,
    entries: [
      {
        type: "message",
        id: "u1",
        parentId: null,
        timestamp,
        message: {
          role: "user",
          content: [
            { type: "text", text: "first" },
            { type: "text", text: "prompt" },
          ],
        },
      },
    ],
  });
  const emptyEnsureSession = makeRuntimeSession({
    id: "empty-runtime",
    filePath: join(tmpdir(), "pi-web-x-missing-empty-session.jsonl"),
    running: false,
    entries: [],
  });
  globalThis.__piSessions = new Map([
    ["visible-runtime", visible],
    ["empty-runtime", emptyEnsureSession],
  ]);
  tcompatCleanups.push(() => {
    globalThis.__piSessions = previousRegistry;
  });

  const infos = getRpcSessionInfos();

  assert.equal(infos.length, 1);
  assert.equal(infos[0].id, "visible-runtime");
  assert.equal(infos[0].firstMessage, "first prompt");
  assert.equal(infos[0].messageCount, 1);
  assert.equal(infos[0].transient, true);
});

test("keeps an idle runtime visible once its JSONL file exists", () => {
  const previousRegistry = globalThis.__piSessions;
  const dir = mkdtempSync(join(tmpdir(), "pi-web-x-runtime-session-"));
  const filePath = join(dir, "session.jsonl");
  writeFileSync(filePath, "persisted\n");
  globalThis.__piSessions = new Map([
    [
      "persisted-runtime",
      makeRuntimeSession({
        id: "persisted-runtime",
        filePath,
        running: false,
        entries: [],
      }),
    ],
  ]);
  tcompatCleanups.push(() => {
    globalThis.__piSessions = previousRegistry;
    rmSync(dir, { recursive: true, force: true });
  });

  const infos = getRpcSessionInfos();

  assert.equal(infos.length, 1);
  assert.equal(infos[0].transient, false);
});
