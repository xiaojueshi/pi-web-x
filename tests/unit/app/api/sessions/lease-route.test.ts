import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";
import {
  hasSelectedSessionLease,
} from "../../../../../lib/selected-session-lease.ts";
import { POST } from "../../../../../app/api/sessions/[id]/lease/route.ts";

const route = await readFile(
  new URL("../../../../../app/api/sessions/[id]/lease/route.ts", import.meta.url),
  "utf8",
);
const appShell = await readFile(
  new URL("../../../../../components/AppShell.tsx", import.meta.url),
  "utf8",
);
const rpcManager = await readFile(
  new URL("../../../../../lib/rpc-manager.ts", import.meta.url),
  "utf8",
);

test("selected-session lease only renews an existing live wrapper and never cold-starts", () => {
  assert.match(route, /getRpcSession\(id\)/);
  assert.match(route, /session\.isAlive\(\)/);
  assert.match(route, /renewSelectedSessionLease\(session, leaseId\)/);
  assert.doesNotMatch(route, /startRpcSession/);
  assert.match(route, /live_session_required/);
});

test("lease endpoint renews only a registered live wrapper", async () => {
  const previous = globalThis.__piSessions;
  const live = { sessionId: "lease-route-live", isAlive: () => true };
  try {
    globalThis.__piSessions = new Map();
    const request = () =>
      new Request("http://localhost", {
        headers: { "x-pi-selected-session-lease": "test-lease" },
      });
    const absent = await POST(request(), {
      params: Promise.resolve({ id: "lease-route-live" }),
    });
    assert.equal(absent.status, 404);

    globalThis.__piSessions.set("lease-route-live", live as never);
    const renewed = await POST(request(), {
      params: Promise.resolve({ id: "lease-route-live" }),
    });
    assert.equal(renewed.status, 200);
    assert.equal(hasSelectedSessionLease(live), true);
  } finally {
    globalThis.__piSessions = previous;
  }
});

test("the selected chat POSTs every 30 seconds and the idle reaper respects its independent lease", () => {
  assert.match(appShell, /\/api\/sessions\/\$\{encodeURIComponent\(sessionId\)\}\/lease/);
  assert.match(appShell, /setInterval\(renew, 30_000\)/);
  const reaper = rpcManager.slice(
    rpcManager.indexOf("  private resetIdleTimer"),
    rpcManager.indexOf("  private persistBashOnlySession"),
  );
  assert.match(reaper, /hasActiveSessionLivenessProvider/);
  assert.match(reaper, /hasSelectedSessionLease\(this\)/);
  assert.match(reaper, /hasExtensionWork \|\| hasSelectedChatLease/);
});
