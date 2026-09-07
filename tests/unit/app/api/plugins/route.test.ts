import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, afterAll } from "bun:test";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const testAgentDir = await mkdtemp(join(tmpdir(), "pi-web-x-plugins-route-"));
process.env.PI_CODING_AGENT_DIR = testAgentDir;

const { allowFileRoot } = await import("../../../../../lib/file-access.ts");
const { GET } = await import("../../../../../app/api/plugins/route.ts");

const allowedCwd = await mkdtemp(join(tmpdir(), "pi-web-x-allowed-"));
await writeFile(
  join(testAgentDir, "settings.json"),
  JSON.stringify({
    packages: ["npm:checkable@latest", "./local-plugin", "npm:pinned@1.2.3"],
  }),
  "utf8",
);
allowFileRoot(allowedCwd);

afterAll(async () => {
  if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  await rm(testAgentDir, { recursive: true, force: true });
  await rm(allowedCwd, { recursive: true, force: true });
});

test("plugins route exposes canCheckForUpdates per package", async () => {
  const response = await GET(
    new Request(
      `http://localhost/api/plugins?cwd=${encodeURIComponent(allowedCwd)}`,
      { headers: { Host: "localhost" } },
    ),
  );
  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    packages?: Array<{ source: string; canCheckForUpdates: boolean }>;
  };
  const bySource = new Map(
    (body.packages ?? []).map((pkg) => [pkg.source, pkg.canCheckForUpdates]),
  );
  assert.equal(bySource.get("npm:checkable@latest"), true);
  assert.equal(bySource.get("./local-plugin"), false);
  assert.equal(bySource.get("npm:pinned@1.2.3"), false);
});
