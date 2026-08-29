import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
const { POST } = await jiti.import(
  "../../../../../../app/api/cwd/validate/route.ts",
);
const { projectIdentityKey } = await jiti.import(
  "../../../../../../lib/project-identity.ts",
);

test("validated cwd responses include server-resolved project identity", async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "pi-web-x-cwd-validate-"));
  tcompatCleanups.push(() => rm(cwd, { recursive: true, force: true }));

  const response = await POST(
    new Request("http://localhost/api/cwd/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd }),
    }),
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    success: true,
    cwd,
    projectRoot: cwd,
    projectKey: projectIdentityKey(cwd),
  });
});
