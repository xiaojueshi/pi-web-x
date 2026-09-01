import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createSession,
  getSetupTokenForTests,
  initializeAuth,
  resetAuthStateForTests,
} from "../../../lib/pi-web-auth";
import { startServer } from "../../../src/server";

let authRoot: string;
let server: ReturnType<typeof startServer> | null = null;

beforeEach(async () => {
  authRoot = mkdtempSync(join(tmpdir(), "pi-web-server-auth-test-"));
  process.env.PI_WEB_X_AUTH_CONFIG_PATH = join(
    authRoot,
    "auth",
    "pi-web-auth.json",
  );
  await resetAuthStateForTests();
  await initializeAuth(getSetupTokenForTests(), "test-password-123");
});

afterEach(async () => {
  if (server) {
    await server.stop(true);
    server = null;
  }
  await resetAuthStateForTests();
  delete process.env.PI_WEB_X_AUTH_CONFIG_PATH;
  rmSync(authRoot, { recursive: true, force: true });
});

test("真实服务器 auth/status 会为 Proxy Request 返回滑动续期 Cookie", async () => {
  const sessionToken = createSession();
  server = startServer({ hostname: "127.0.0.1", port: 0 });
  assert.ok(server.port !== undefined);

  const response = await fetch(
    `http://127.0.0.1:${server.port}/api/auth/status`,
    {
      headers: { cookie: `pi_web_x_session=${sessionToken}` },
    },
  );

  assert.equal(response.status, 200);
  const body = (await response.json()) as {
    initialized: boolean;
    authenticated: boolean;
  };
  assert.deepEqual(body, { initialized: true, authenticated: true });
  const setCookie = response.headers.get("set-cookie");
  assert.ok(setCookie !== null);
  assert.ok(setCookie.startsWith("pi_web_x_session="));
  assert.ok(setCookie.includes("Max-Age=86400"));
});
