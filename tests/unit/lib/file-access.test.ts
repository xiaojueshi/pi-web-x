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

// Loaded through jiti so the module's own extensionless imports resolve the way
// the app resolves them (tsconfig moduleResolution: "bundler"); bare
// `import("../../../lib/path-security.ts")` only works while that file has no imports.
async function loadSubject() {
  return import("../../../lib/path-security.ts");
}

test("rejects an existing path that escapes an allowed root through a symlink", async () => {
  const { isExistingPathWithinRoots, isPathWithinRoots } = await loadSubject();
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-x-file-access-"));
  tcompatCleanups.push(() => fs.rmSync(base, { recursive: true, force: true }));
  const allowed = path.join(base, "allowed");
  const outside = path.join(base, "outside");
  fs.mkdirSync(allowed);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, "secret.txt"), "secret");
  const link = path.join(allowed, "link");
  fs.symlinkSync(
    outside,
    link,
    process.platform === "win32" ? "junction" : "dir",
  );
  const target = path.join(link, "secret.txt");
  const roots = new Set([allowed]);

  assert.equal(isPathWithinRoots(target, roots), true);
  assert.equal(isExistingPathWithinRoots(target, roots), false);
});
