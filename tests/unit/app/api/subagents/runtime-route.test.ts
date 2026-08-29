import assert from "node:assert/strict";
import { test } from "bun:test";
import { createJiti } from "jiti";
import { afterEach, beforeEach } from "bun:test";

// node:test t.after 的 Bun 原生替代：测试开始前清空、结束后按 LIFO 执行清理。
const tcompatCleanups: (() => void)[] = [];
beforeEach(() => {
  tcompatCleanups.length = 0;
});
afterEach(async () => {
  for (const fn of tcompatCleanups.splice(0).reverse()) await fn();
});

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { GET, POST } = await jiti.import(
  "../../../../../app/api/subagents/[id]/route.ts",
);

const id = "subagent-route-test";
const context = { params: Promise.resolve({ id }) };

function request(body) {
  return new Request(`http://localhost/api/subagents/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function installRunningSubagent() {
  const previousRegistry = globalThis.__piSessions;
  const previousRuns = globalThis.__piSubagentRuns;
  let running = true;
  const steered = [];
  let aborts = 0;
  const entries = [
    {
      type: "custom",
      customType: "pi-web-x:subagent",
      id: "meta",
      parentId: null,
      timestamp: "2026-01-01T00:00:00.000Z",
      data: {
        version: 1,
        parentSessionId: "parent",
        parentSessionPath: "/tmp/parent.jsonl",
        parentToolCallId: "tool-call",
        profile: "Explore",
        description: "Inspect",
        task: "Inspect files",
        runInBackground: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    },
  ];
  globalThis.__piSubagentRuns = new Map();
  globalThis.__piSessions = new Map([
    [
      id,
      {
        isAlive: () => true,
        isRunning: () => running,
        sessionFile: `/tmp/${id}.jsonl`,
        inner: {
          sessionManager: { getEntries: () => entries },
          steer: async (message) => {
            steered.push(message);
          },
          abort: async () => {
            aborts += 1;
          },
        },
      },
    ],
  ]);
  tcompatCleanups.push(() => {
    globalThis.__piSessions = previousRegistry;
    globalThis.__piSubagentRuns = previousRuns;
  });
  return {
    steered,
    get aborts() {
      return aborts;
    },
    stop() {
      running = false;
    },
  };
}

test("subagent route reads live state and accepts steer and abort actions", async () => {
  const state = installRunningSubagent();

  const getResponse = await GET(
    new Request(`http://localhost/api/subagents/${id}`),
    context,
  );
  const getBody = await getResponse.json();
  assert.equal(getResponse.status, 200);
  assert.equal(getBody.run.status, "running");
  assert.equal(getBody.run.profile, "Explore");

  const steerResponse = await POST(
    request({ action: "steer", message: "  focus on tests  " }),
    context,
  );
  assert.equal(steerResponse.status, 200);
  assert.deepEqual(state.steered, ["focus on tests"]);

  const abortResponse = await POST(request({ action: "abort" }), context);
  assert.equal(abortResponse.status, 200);
  assert.equal(state.aborts, 1);
});

test("subagent route validates actions and rejects commands after completion", async () => {
  const state = installRunningSubagent();

  let response = await POST(
    request({ action: "steer", message: "  " }),
    context,
  );
  assert.equal(response.status, 400);
  response = await POST(request({ action: "unknown" }), context);
  assert.equal(response.status, 400);

  state.stop();
  response = await POST(request({ action: "abort" }), context);
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /not running/);
});

test("subagent GET returns 404 for an unknown session", async () => {
  const previousRegistry = globalThis.__piSessions;
  const previousRuns = globalThis.__piSubagentRuns;
  globalThis.__piSessions = new Map();
  globalThis.__piSubagentRuns = new Map();
  tcompatCleanups.push(() => {
    globalThis.__piSessions = previousRegistry;
    globalThis.__piSubagentRuns = previousRuns;
  });

  const missingId = `missing-subagent-${Date.now()}`;
  const response = await GET(
    new Request(`http://localhost/api/subagents/${missingId}`),
    { params: Promise.resolve({ id: missingId }) },
  );
  assert.equal(response.status, 404);
});
