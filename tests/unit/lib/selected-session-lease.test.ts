import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  SELECTED_SESSION_LEASE_TTL_MS,
  clearSelectedSessionLease,
  hasSelectedSessionLease,
  renewSelectedSessionLease,
} from "../../../lib/selected-session-lease.ts";

function holder(sessionId = "selected-session") {
  let alive = true;
  return {
    sessionId,
    isAlive: () => alive,
    stop: () => {
      alive = false;
    },
  };
}

test("selected session lease is live-wrapper scoped and expires after 90 seconds", () => {
  const live = holder();
  assert.equal(renewSelectedSessionLease(live, "lease-a", 1_000), true);
  assert.equal(hasSelectedSessionLease(live, 1_000 + SELECTED_SESSION_LEASE_TTL_MS - 1), true);
  assert.equal(hasSelectedSessionLease(live, 1_000 + SELECTED_SESSION_LEASE_TTL_MS), false);
});

test("selected session lease neither survives wrapper replacement nor dead wrappers", () => {
  const first = holder("same-session");
  const replacement = holder("same-session");
  assert.equal(renewSelectedSessionLease(first, "lease-a", 1), true);
  assert.equal(hasSelectedSessionLease(replacement, 2), false);
  first.stop();
  assert.equal(hasSelectedSessionLease(first, 2), false);
  assert.equal(renewSelectedSessionLease(first, "lease-a", 3), false);
  clearSelectedSessionLease(first);
});
