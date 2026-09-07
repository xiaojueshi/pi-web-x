import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, afterAll } from "bun:test";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(
  join(tmpdir(), "pi-web-x-plugins-check-route-"),
);
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const { allowFileRoot } = await import("../../../../../lib/file-access.ts");
const { POST } = await import("../../../../../app/api/plugins/check/route.ts");

// 已允许的项目 cwd（含一个配置了本地包的项目）与一个未允许的 cwd
const allowedCwd = await mkdtemp(join(tmpdir(), "pi-web-x-allowed-"));
await writeFile(
  join(testAgentDir, "settings.json"),
  JSON.stringify({ packages: ["./local-plugin"] }),
  "utf8",
);
allowFileRoot(allowedCwd);
const deniedCwd = await mkdtemp(join(tmpdir(), "pi-web-x-denied-"));

afterAll(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
  await rm(allowedCwd, { recursive: true, force: true });
  await rm(deniedCwd, { recursive: true, force: true });
});

function request(body: unknown, contentType = "application/json") {
  return new Request("http://localhost/api/plugins/check", {
    method: "POST",
    headers: { "Content-Type": contentType, Host: "localhost" },
    body: JSON.stringify(body),
  });
}

test("check route validates cwd and request shape", async () => {
  // 缺少 cwd
  let response = await POST(request({}));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "cwd required" });

  // 非 JSON Content-Type
  response = await POST(request({ cwd: allowedCwd }, "text/plain"));
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), {
    error: "Content-Type must be application/json",
  });

  // source 与 scope 必须成对提供
  response = await POST(request({ cwd: allowedCwd, source: "npm:pkg" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "source and scope must be provided together",
  });

  // 未允许的 cwd 拒绝访问
  response = await POST(request({ cwd: deniedCwd }));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Access denied" });
});

test("check route returns the configured packages for a full check", async () => {
  const response = await POST(request({ cwd: allowedCwd }));
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    updates?: Array<{ state: string; source: string; type: string }>;
    error?: string;
  };
  // 全局 settings.json 配置了本地包，非 npm/git 来源返回 unsupported
  assert.equal(body.updates?.length, 1);
  assert.equal(body.updates?.[0]?.source, "./local-plugin");
  assert.equal(body.updates?.[0]?.state, "unsupported");
  assert.equal(body.updates?.[0]?.type, "git");
});

test("check route 404s when a filtered package is not configured", async () => {
  const response = await POST(
    request({ cwd: allowedCwd, source: "npm:not-configured", scope: "global" }),
  );
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "Configured package not found",
  });
});
