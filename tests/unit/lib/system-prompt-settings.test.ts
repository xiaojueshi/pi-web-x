import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "bun:test";
import {
  getSystemPromptPath,
  readSystemPrompt,
  readSystemPromptSettings,
  writeSystemPrompt,
} from "../../../lib/system-prompt-settings.ts";

function createTempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-x-system-prompt-"));
}

test("系统提示词默认为空，并保存在用户级 SYSTEM.md", () => {
  const root = createTempRoot();
  try {
    const promptPath = getSystemPromptPath(root);
    assert.equal(promptPath, path.join(root, "SYSTEM.md"));
    assert.equal(readSystemPrompt(undefined, root), "");

    assert.equal(
      writeSystemPrompt("Always reply in Chinese.", "system", root),
      "Always reply in Chinese.",
    );
    assert.equal(readSystemPrompt(undefined, root), "Always reply in Chinese.");
    if (process.platform !== "win32")
      assert.equal(fs.statSync(promptPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("未设置 SYSTEM.md 时回退读取全局 AGENTS.md，并写回同一文件", () => {
  const root = createTempRoot();
  try {
    const agentsPath = path.join(root, "AGENTS.md");
    fs.writeFileSync(agentsPath, "Always use Chinese.");

    assert.deepEqual(readSystemPromptSettings(root), {
      prompt: "Always use Chinese.",
      source: "agents",
    });
    assert.equal(readSystemPrompt(undefined, root), "Always use Chinese.");
    assert.equal(
      writeSystemPrompt("Keep answers concise.", "agents", root),
      "Keep answers concise.",
    );
    assert.equal(fs.readFileSync(agentsPath, "utf8"), "Keep answers concise.");
    assert.equal(fs.existsSync(getSystemPromptPath(root)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("保存空系统提示词会删除覆盖文件并恢复默认行为", () => {
  const root = createTempRoot();
  try {
    const promptPath = getSystemPromptPath(root);
    writeSystemPrompt("Custom prompt", "system", root);
    assert.equal(writeSystemPrompt("   ", "system", root), "");
    assert.equal(fs.existsSync(promptPath), false);
    assert.equal(readSystemPrompt(undefined, root), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
