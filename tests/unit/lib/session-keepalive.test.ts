import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "bun:test";
import {
  checkSessionAuthentication,
  SESSION_AUTH_STATUS_EVENT,
  type SessionAuthStatus,
} from "../../../lib/session-keepalive";

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let browserEvents: EventTarget;

beforeEach(() => {
  browserEvents = new EventTarget();
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: browserEvents,
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalWindow) {
    Object.defineProperty(globalThis, "window", originalWindow);
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

test("认证状态失效时通知 AuthGate，且不把网络错误误判为退出", async () => {
  let received: SessionAuthStatus | null = null;
  browserEvents.addEventListener(SESSION_AUTH_STATUS_EVENT, (event) => {
    received = (event as CustomEvent<SessionAuthStatus>).detail;
  });
  globalThis.fetch = (async () =>
    Response.json({
      initialized: true,
      authenticated: false,
    })) as unknown as typeof fetch;

  assert.equal(await checkSessionAuthentication(), false);
  assert.deepEqual(received, { initialized: true, authenticated: false });

  received = null;
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  assert.equal(await checkSessionAuthentication(), null);
  assert.equal(received, null);
});

test("认证仍有效时不触发登录墙", async () => {
  let eventCount = 0;
  browserEvents.addEventListener(SESSION_AUTH_STATUS_EVENT, () => {
    eventCount += 1;
  });
  globalThis.fetch = (async () =>
    Response.json({
      initialized: true,
      authenticated: true,
    })) as unknown as typeof fetch;

  assert.equal(await checkSessionAuthentication(), true);
  assert.equal(eventCount, 0);
});
