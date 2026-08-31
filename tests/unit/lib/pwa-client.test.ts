import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  getPwaConnectionKind,
  getPwaConnectionStatus,
  isLoopbackHostname,
  isPrivateIpv4Hostname,
} from "../../../lib/pwa-client";

test("classifies loopback and private LAN addresses without claiming public reachability", () => {
  assert.equal(isLoopbackHostname("localhost"), true);
  assert.equal(isLoopbackHostname("127.0.0.1"), true);
  assert.equal(isLoopbackHostname("agent.localhost"), true);
  assert.equal(isPrivateIpv4Hostname("192.168.1.20"), true);
  assert.equal(isPrivateIpv4Hostname("172.31.8.4"), true);
  assert.equal(isPrivateIpv4Hostname("172.32.8.4"), false);
  assert.equal(getPwaConnectionKind("10.0.0.4"), "lan");
  assert.equal(getPwaConnectionKind("pi.example.test"), "other");
});

test("only reports PWA capabilities in a browser secure context", () => {
  assert.deepEqual(
    getPwaConnectionStatus(new URL("http://192.168.1.20:30141"), false),
    { kind: "lan", secure: false, pwaCapabilitiesAvailable: false },
  );
  assert.deepEqual(
    getPwaConnectionStatus(new URL("https://pi.example.test"), true),
    { kind: "other", secure: true, pwaCapabilitiesAvailable: true },
  );
});
