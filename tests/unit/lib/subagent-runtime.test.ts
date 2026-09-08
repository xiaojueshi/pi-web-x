import assert from "node:assert/strict";
import { test } from "bun:test";

const { createSubagentController } = await import(
  "../../../lib/subagent-runtime.ts"
);

function completedRun() {
  return {
    sessionId: "child-session",
    sessionPath: "/tmp/child.jsonl",
    parentSessionId: "parent-session",
    parentToolCallId: "tool-call",
    profile: "Explore",
    description: "Inspect parser",
    task: "Find the parser",
    runInBackground: true,
    status: "completed",
    createdAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    result: "Parser found",
  };
}

test("completion notification reopens an idle parent and uses its current session", async () => {
  const delivered = [];
  const reopened = [];
  let ready = false;
  let parent;
  const liveParent = {
    cwd: "/tmp",
    sessionFile: "/tmp/parent.jsonl",
    isAlive: () => true,
    isRunning: () => false,
    waitUntilReady: async () => {
      ready = true;
    },
    inner: {
      sendCustomMessage: async (message, options) =>
        delivered.push({ message, options }),
    },
  };
  const controller = createSubagentController({
    getSession: () => parent,
    registerSession: () => {},
    reopenSession: async (sessionId, sessionFile) => {
      reopened.push([sessionId, sessionFile]);
      parent = liveParent;
      return liveParent;
    },
    resolveSessionPath: async () => "/tmp/parent.jsonl",
    invalidateSessionList: () => {},
  });

  await controller.extensionRuntime.notifyParent(completedRun());

  assert.deepEqual(reopened, [["parent-session", "/tmp/parent.jsonl"]]);
  assert.equal(ready, true);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].message.content, "Parser found");
  assert.equal(delivered[0].message.details.sessionId, "child-session");
  assert.deepEqual(delivered[0].options, {
    deliverAs: "followUp",
    triggerTurn: true,
  });
});

test("parent abort cascades only to its active subagents", async () => {
  const previousRuns = globalThis.__piSubagentRuns;
  const aborts: string[] = [];
  globalThis.__piSubagentRuns = new Map([
    [
      "child-running",
      {
        run: {
          sessionId: "child-running",
          parentSessionId: "parent",
          status: "running",
        },
        completion: Promise.resolve(),
        abortRequested: false,
        suppressParentNotification: false,
      },
    ],
    [
      "child-starting",
      {
        run: {
          sessionId: "child-starting",
          parentSessionId: "parent",
          status: "starting",
        },
        completion: Promise.resolve(),
        abortRequested: false,
        suppressParentNotification: false,
      },
    ],
    [
      "child-other-parent",
      {
        run: {
          sessionId: "child-other-parent",
          parentSessionId: "other",
          status: "running",
        },
        completion: Promise.resolve(),
        abortRequested: false,
        suppressParentNotification: false,
      },
    ],
    [
      "child-completed",
      {
        run: {
          sessionId: "child-completed",
          parentSessionId: "parent",
          status: "completed",
        },
        completion: Promise.resolve(),
        abortRequested: false,
        suppressParentNotification: false,
      },
    ],
  ]);
  try {
    const controller = createSubagentController({
      getSession: (sessionId) => ({
        isAlive: () => true,
        isRunning: () => sessionId !== "child-completed",
        inner: { abort: async () => void aborts.push(sessionId) },
      }),
      registerSession: () => {},
      reopenSession: async () => {
        throw new Error("unused");
      },
      resolveSessionPath: async () => null,
      invalidateSessionList: () => {},
    });

    await controller.abortForParent("parent");

    assert.deepEqual(aborts.sort(), ["child-running", "child-starting"]);
    for (const sessionId of ["child-running", "child-starting"]) {
      const stored = globalThis.__piSubagentRuns.get(sessionId);
      assert.equal(stored.abortRequested, true);
      assert.equal(stored.suppressParentNotification, true);
    }
    assert.equal(
      globalThis.__piSubagentRuns.get("child-other-parent").abortRequested,
      false,
    );
    assert.equal(
      globalThis.__piSubagentRuns.get("child-completed").abortRequested,
      false,
    );
  } finally {
    globalThis.__piSubagentRuns = previousRuns;
  }
});

test("disabled built-in subagents reject stale Agent calls before starting", async () => {
  const controller = createSubagentController({
    getSession: () => {
      throw new Error("must not inspect a parent");
    },
    registerSession: () => {},
    reopenSession: async () => {
      throw new Error("unused");
    },
    resolveSessionPath: async () => null,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => false,
  });

  await assert.rejects(
    controller.extensionRuntime.start({
      parentContext: { sessionManager: { getSessionId: () => "parent" } },
      parentToolCallId: "call",
      profile: "explore",
      task: "Inspect",
      description: "Inspect",
    }),
    /built-in sub-agents are disabled/,
  );
});

test("enabled built-in subagents pass the gate and proceed to parent checks", async () => {
  const controller = createSubagentController({
    getSession: () => null,
    registerSession: () => {},
    reopenSession: async () => null,
    resolveSessionPath: async () => null,
    invalidateSessionList: () => {},
    isBuiltInSubagentsEnabled: () => true,
  });

  // 门禁已开（不再报 disabled），继续走到 parent 会话检查并明确报错。
  await assert.rejects(
    controller.extensionRuntime.start({
      parentContext: { sessionManager: { getSessionId: () => "parent" } },
      parentToolCallId: "call",
      profile: "explore",
      task: "Inspect",
      description: "Inspect",
    }),
    /Parent session is no longer available/,
  );
});
