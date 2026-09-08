import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const source = await readFile(
  new URL("../../../components/ChatWindow.tsx", import.meta.url),
  "utf8",
);

test("subagent chat views suppress every direct mutation entry point", () => {
  assert.match(
    source,
    /const isReadOnlySubagent = session\?\.relation\?\.kind === "subagent"/,
  );
  assert.match(source, /const chatInputElement = isReadOnlySubagent \?/);
  assert.match(source, /!isReadOnlySubagent && isDragOver/);
  assert.match(
    source,
    /onDrop=\{isReadOnlySubagent \? undefined : handleDrop\}/,
  );
  assert.match(source, /!isReadOnlySubagent && extensionCustomUi/);
  assert.match(source, /!isReadOnlySubagent && extensionDialog/);
  assert.match(
    source,
    /!isReadOnlySubagent && sessionBusy \? handleAbort : null/,
  );
});

test("parent chat reports when it is waiting for foreground subagents", () => {
  assert.match(source, /runningSubagentCount = 0/);
  assert.match(source, /agentRunning && runningSubagentCount > 0/);
  assert.match(source, /settings\.subagentWaiting/);
});
