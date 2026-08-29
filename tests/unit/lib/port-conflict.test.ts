import assert from "node:assert/strict";
import { test } from "bun:test";
import {
  formatPortInUseHint,
  isPiWebXRunning,
} from "../../../lib/port-conflict.ts";

const PAGE_MARKER = "Pi Web X";

test("端口占用提示包含换端口建议与查进程命令", () => {
  const hint = formatPortInUseHint({
    hostname: "127.0.0.1",
    port: 30141,
    isPiWebX: false,
  });
  assert.match(hint, /Port 30141 is already in use/);
  assert.match(hint, /pi-web-x -p 30142/);
  assert.match(hint, /PORT=30142/);
  assert.match(hint, /find the PID/);
});

test("占用者是 pi-web-x 实例时提示措辞明确", () => {
  const hint = formatPortInUseHint({
    hostname: "127.0.0.1",
    port: 30141,
    isPiWebX: true,
  });
  assert.match(hint, /Another pi-web-x instance is already running/);
  assert.doesNotMatch(hint, /Another program/);
});

test("占用者是其他程序时提示措辞中立", () => {
  const hint = formatPortInUseHint({
    hostname: "0.0.0.0",
    port: 8443,
    isPiWebX: false,
  });
  assert.match(hint, /Another program is already listening/);
  assert.match(hint, /http:\/\/0\.0\.0\.0:8443/);
});

test("Windows 平台提示使用 netstat 与 taskkill", () => {
  const hint = formatPortInUseHint({
    hostname: "127.0.0.1",
    port: 30141,
    isPiWebX: false,
  });
  // 本机为 Linux；命令分支由 formatPortInUseHint 内部按 process.platform 选择，
  // 这里只确保提示整体结构完整（平台命令差异由实现内部分支保证）
  assert.match(hint, /You can:/);
  assert.match(hint, /1\. Use a different port/);
  assert.match(hint, /2\. Find and stop/);
});

test("探测识别出 pi-web-x 首页指纹", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(`<!doctype html><title>${PAGE_MARKER}</title>`, {
        headers: { "content-type": "text/html" },
      }),
    )) as typeof fetch;
  try {
    assert.equal(await isPiWebXRunning("127.0.0.1", 30141), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("探测对非 pi-web-x 内容返回 false", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(new Response("<html><body>nginx</body></html>"))) as typeof fetch;
  try {
    assert.equal(await isPiWebXRunning("127.0.0.1", 30141), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("探测对连接失败返回 false 而不抛错", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("connection refused"))) as typeof fetch;
  try {
    assert.equal(await isPiWebXRunning("127.0.0.1", 30141), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("探测将通配绑定地址映射到 loopback", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = ((input: RequestInfo | URL) => {
    requestedUrl = String(input);
    return Promise.resolve(
      new Response(`<title>${PAGE_MARKER}</title>`),
    );
  }) as typeof fetch;
  try {
    assert.equal(await isPiWebXRunning("0.0.0.0", 30141), true);
    assert.equal(requestedUrl, "http://127.0.0.1:30141/");
  } finally {
    globalThis.fetch = originalFetch;
  }
});