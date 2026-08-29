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

async function loadSubject() {
  return import("../../../lib/file-dirent.ts");
}

test("uses Dirent types for regular files and directories", async () => {
  const { resolveDirentIsDirectory } = await loadSubject();
  const file = { isDirectory: () => false, isFile: () => true };
  const directory = { isDirectory: () => true, isFile: () => false };

  assert.equal(resolveDirentIsDirectory(file, "/unused/file"), false);
  assert.equal(resolveDirentIsDirectory(directory, "/unused/directory"), true);
});

test("falls back to stat when the Dirent type is unknown", async () => {
  const { resolveDirentIsDirectory } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-x-dirent-"));
  tcompatCleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const directoryPath = path.join(root, "directory");
  fs.mkdirSync(directoryPath);

  const unknown = { isDirectory: () => false, isFile: () => false };
  assert.equal(resolveDirentIsDirectory(unknown, directoryPath), true);
});

test("follows directory symlinks and skips dangling symlinks", async () => {
  const { resolveDirentIsDirectory } = await loadSubject();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-x-dirent-"));
  tcompatCleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "target"));
  try {
    fs.symlinkSync("target", path.join(root, "directory-link"), "dir");
    fs.symlinkSync("missing", path.join(root, "dangling-link"), "file");
  } catch (error) {
    if (error?.code === "EPERM") {
      console.warn(
        "跳过（bun:test 无运行时 skip）：",
        "Creating symbolic links requires additional privileges on this platform",
      );
      return;
    }
    throw error;
  }

  const symlink = { isDirectory: () => false, isFile: () => false };
  assert.equal(
    resolveDirentIsDirectory(symlink, path.join(root, "directory-link")),
    true,
  );
  assert.equal(
    resolveDirentIsDirectory(symlink, path.join(root, "dangling-link")),
    null,
  );
});
