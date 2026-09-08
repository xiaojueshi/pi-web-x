import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, test } from "bun:test";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(
  join(tmpdir(), "pi-web-x-system-prompt-route-"),
);
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const { GET, PUT } = await import(
  "../../../../../app/api/system-prompt/route.ts"
);

afterAll(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
});

function request(
  prompt: unknown,
  source: unknown = "none",
  contentType = "application/json",
): Request {
  return new Request("http://localhost/api/system-prompt", {
    method: "PUT",
    headers: { "Content-Type": contentType, Host: "localhost" },
    body: JSON.stringify({ prompt, source }),
  });
}

test("系统提示词路由读取并持久化用户级 SYSTEM.md", async () => {
  let response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { prompt: "", source: "none" });

  response = await PUT(request("Always reply in Chinese."));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    prompt: "Always reply in Chinese.",
    source: "system",
  });
  assert.equal(
    await readFile(join(testAgentDir, "SYSTEM.md"), "utf8"),
    "Always reply in Chinese.",
  );

  response = await PUT(request("", "system"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { prompt: "", source: "none" });
});

test("系统提示词路由回退读取并写回全局 AGENTS.md", async () => {
  await writeFile(join(testAgentDir, "AGENTS.md"), "Always use Chinese.");

  let response = await GET();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    prompt: "Always use Chinese.",
    source: "agents",
  });

  response = await PUT(request("Keep answers concise.", "agents"));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    prompt: "Keep answers concise.",
    source: "agents",
  });
  assert.equal(
    await readFile(join(testAgentDir, "AGENTS.md"), "utf8"),
    "Keep answers concise.",
  );
});

test("系统提示词路由验证变更请求", async () => {
  let response = await PUT(request(42));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "prompt must be a string" });

  response = await PUT(request("prompt", "none", "text/plain"));
  assert.equal(response.status, 415);
  assert.deepEqual(await response.json(), {
    error: "Content-Type must be application/json",
  });

  response = await PUT(request("prompt", "invalid"));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "source must be a valid system prompt source",
  });
});
