import assert from "node:assert/strict";
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

const { AgentCommandError, isPromptRejectedError, sendAgentCommand } =
  await import("../../../lib/agent-client.ts");

test("agent command HTTP rejections are distinguishable from transport failures", async () => {
  const originalFetch = globalThis.fetch;
  tcompatCleanups.push(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        error: "Authentication failed",
        code: "prompt_rejected",
        accepted: false,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );

  await assert.rejects(
    sendAgentCommand("session-id", { type: "prompt", message: "hello" }),
    (error) => {
      assert.equal(error instanceof AgentCommandError, true);
      assert.equal(error.status, 500);
      assert.equal(error.message, "Authentication failed");
      assert.equal(error.code, "prompt_rejected");
      assert.equal(error.accepted, false);
      assert.equal(isPromptRejectedError(error), true);
      return true;
    },
  );

  const transportError = new TypeError("connection reset");
  globalThis.fetch = async () => {
    throw transportError;
  };

  await assert.rejects(
    sendAgentCommand("session-id", { type: "prompt", message: "hello" }),
    (error) => {
      assert.equal(error, transportError);
      assert.equal(error instanceof AgentCommandError, false);
      assert.equal(isPromptRejectedError(error), false);
      return true;
    },
  );
});

test("only an explicit negative prompt acknowledgement is definitive", () => {
  assert.equal(
    isPromptRejectedError(new AgentCommandError("proxy failure", 502)),
    false,
  );
  assert.equal(
    isPromptRejectedError(
      new AgentCommandError(
        "generic API failure",
        500,
        "internal_error",
        false,
      ),
    ),
    false,
  );
});
