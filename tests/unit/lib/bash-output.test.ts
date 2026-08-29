import assert from "node:assert/strict";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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
  return import("../../../lib/bash-output.ts");
}

test("accepts only pi bash logs directly inside the configured temp directory", async () => {
  const { resolveBashOutputPath } = await loadSubject();
  const tempRoot = join(tmpdir(), "pi-web-x-output-tests");
  const expected = resolve(tempRoot, "pi-bash-ab12.log");

  assert.equal(
    resolveBashOutputPath(join(tempRoot, "pi-bash-ab12.log"), tempRoot),
    expected,
  );
  assert.equal(
    resolveBashOutputPath(join(tempRoot, "..", "pi-bash-ab12.log"), tempRoot),
    null,
  );
  assert.equal(
    resolveBashOutputPath(join(tempRoot, "pi-bash-ab12.log.bak"), tempRoot),
    null,
  );
  assert.equal(
    resolveBashOutputPath(
      join(`${tempRoot}-other`, "pi-bash-ab12.log"),
      tempRoot,
    ),
    null,
  );
});

test("reads small output and rejects oversized inline output before buffering it", async () => {
  const { readUtf8FileWithinLimit } = await loadSubject();
  const dir = await mkdtemp(join(tmpdir(), "pi-web-x-bash-output-"));
  const filePath = join(dir, "pi-bash-ab12.log");
  try {
    await writeFile(filePath, "shell output", "utf8");

    assert.deepEqual(await readUtf8FileWithinLimit(filePath, 32), {
      tooLarge: false,
      content: "shell output",
      size: 12,
    });
    assert.deepEqual(await readUtf8FileWithinLimit(filePath, 4), {
      tooLarge: true,
      size: 12,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("rejects symbolic links when opening bash output", async () => {
  const { readUtf8FileWithinLimit } = await loadSubject();
  const dir = await mkdtemp(join(tmpdir(), "pi-web-x-bash-output-link-"));
  const targetPath = join(dir, "target.log");
  const linkPath = join(dir, "pi-bash-link.log");
  try {
    await writeFile(targetPath, "not authorized through a link", "utf8");
    try {
      await symlink(targetPath, linkPath);
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
    await assert.rejects(() => readUtf8FileWithinLimit(linkPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
