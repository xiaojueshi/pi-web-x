import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, afterAll } from "bun:test";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-x-sessions-search-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const { GET } = await import("../../../../../app/api/sessions/search/route.ts");
// bun test 所有文件共享 globalThis：listAllSessions 的 30s TTL 缓存
// 可能被先跑的其他测试文件填充，导致本路由拿到别的临时目录的会话。
// 请求前主动失效，保证路由针对本文件的 agent 目录重新扫描。
const { invalidateSessionListCache } = await import(
  "../../../../../lib/session-reader.ts"
);

// 会话文件须位于 <agentDir>/sessions/<project>/ 且带 session 头，SDK 才可发现。
const projectDir = join(testAgentDir, "sessions", "project");
const cwd = "/tmp/pi-web-x-search-project";
await mkdir(projectDir, { recursive: true });
await writeFile(
  join(projectDir, "2026-01-01T00-00-00-000Z_search-session.jsonl"),
  `${JSON.stringify({
    type: "session",
    version: 3,
    id: "search-session",
    timestamp: "2026-01-01T00:00:00.000Z",
    cwd,
  })}\n${JSON.stringify({
    type: "message",
    id: "entry-1",
    parentId: null,
    timestamp: "2026-01-01T00:00:01.000Z",
    message: { role: "user", content: "hello needle world" },
  })}\n`,
  "utf8",
);

afterAll(async () => {
  // 同理，不把本文件临时目录的缓存留给后续测试文件。
  invalidateSessionListCache();
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

test("search route returns literal matches with entry/block context", async () => {
  invalidateSessionListCache();
  const res = await GET(
    new Request(
      `http://localhost/api/sessions/search?q=${encodeURIComponent("needle")}`,
    ),
  );
  assert.equal(res.status, 200);
  const data = (await res.json()) as {
    results: Array<{
      session: { id: string };
      entryId?: string;
      blockIndex: number;
      match: string;
    }>;
    truncated: boolean;
  };
  assert.equal(data.results.length, 1);
  assert.equal(data.results[0].session.id, "search-session");
  assert.equal(data.results[0].entryId, "entry-1");
  assert.equal(data.results[0].blockIndex, 0);
  assert.equal(data.results[0].match, "needle");
  assert.equal(data.truncated, false);
});

test("search route rejects oversized queries with 400", async () => {
  const res = await GET(
    new Request(`http://localhost/api/sessions/search?q=${"x".repeat(201)}`),
  );
  assert.equal(res.status, 400);
  const data = (await res.json()) as { error?: string };
  assert.match(String(data.error), /200 characters/);
});

test("search route returns an empty result set for empty queries", async () => {
  const res = await GET(new Request("http://localhost/api/sessions/search?q="));
  assert.equal(res.status, 200);
  const data = (await res.json()) as { results: unknown[]; truncated: boolean };
  assert.deepEqual(data, { results: [], truncated: false });
});
