import assert from "node:assert/strict";
import { test } from "bun:test";

const { hasActiveSessionLivenessProvider, registerSessionLivenessProvider } =
  await import("../../../lib/session-liveness.ts");

test("an active extension liveness provider preserves its matching session", () => {
  let active = true;
  const dispose = registerSessionLivenessProvider({
    name: "test-extension",
    sessionId: "session-a",
    isActive: () => active,
  });
  try {
    assert.equal(
      hasActiveSessionLivenessProvider({ sessionId: "session-a" }),
      true,
    );
    assert.equal(
      hasActiveSessionLivenessProvider({ sessionId: "session-b" }),
      false,
    );
    active = false;
    assert.equal(
      hasActiveSessionLivenessProvider({ sessionId: "session-a" }),
      false,
    );
  } finally {
    dispose();
  }
});

test("a failing extension liveness provider preserves its matching session", () => {
  const previousError = console.error;
  console.error = () => {};
  const dispose = registerSessionLivenessProvider({
    name: "failing-extension",
    sessionFile: "/tmp/session.jsonl",
    sessionId: "session-a",
    isActive: () => {
      throw new Error("provider failure");
    },
  });
  try {
    assert.equal(
      hasActiveSessionLivenessProvider({
        sessionId: "other-session",
        sessionFile: "/tmp/session.jsonl",
      }),
      true,
    );
  } finally {
    dispose();
    console.error = previousError;
  }
});
