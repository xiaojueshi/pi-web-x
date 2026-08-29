import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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


const { writePrivateFileAtomicSync } = await import(
  "../../../lib/atomic-file.ts"
);

function createTempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-x-atomic-file-"));
  tcompatCleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("atomically replaces a file with restrictive permissions", () => {
  const root = createTempRoot();
  const destination = path.join(root, "models.json");
  fs.writeFileSync(destination, "old", { mode: 0o644 });

  writePrivateFileAtomicSync(destination, "new");

  assert.equal(fs.readFileSync(destination, "utf8"), "new");
  assert.deepEqual(fs.readdirSync(root), ["models.json"]);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(destination).mode & 0o777, 0o600);
  }
});

test("keeps the destination and removes the temporary file when replacement fails", () => {
  const root = createTempRoot();
  const destination = path.join(root, "models.json");
  fs.mkdirSync(destination);

  assert.throws(() => writePrivateFileAtomicSync(destination, "new"));
  assert.equal(fs.statSync(destination).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(root), ["models.json"]);
});
