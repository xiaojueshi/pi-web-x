import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "bun:test";

const appShellSource = await readFile(
  new URL("../../../components/AppShell.tsx", import.meta.url),
  "utf8",
);
const keepAliveSource = await readFile(
  new URL("../../../lib/session-keepalive.ts", import.meta.url),
  "utf8",
);
const statusRouteSource = await readFile(
  new URL("../../../app/api/auth/status/route.ts", import.meta.url),
  "utf8",
);
const authGateSource = await readFile(
  new URL("../../../components/AuthGate.tsx", import.meta.url),
  "utf8",
);

// 会话滑动续期：AppShell（认证通过后才渲染）启动保活，
// 保活通过轻量 /api/auth/status 触发服务端续期。
test("登录后启动会话保活，保活端点顺带滑动续期", () => {
  // AppShell 挂载保活
  assert.match(
    appShellSource,
    /useEffect\(\(\) => startSessionKeepAlive\(\), \[\]\)/,
  );
  // 保活逻辑：挂载后立即检查，并在定时器/回到前台时再次检查。
  assert.match(keepAliveSource, /setInterval/);
  assert.match(keepAliveSource, /visibilitychange/);
  assert.match(keepAliveSource, /ping\(\);/);
  assert.match(
    keepAliveSource,
    /fetch\("\/api\/auth\/status", \{ cache: "no-store" \}\)/,
  );
  // 会话失效只通知认证墙切换登录视图，不调用 Agent stop/abort。
  assert.match(keepAliveSource, /SESSION_AUTH_STATUS_EVENT/);
  assert.match(authGateSource, /addEventListener\(SESSION_AUTH_STATUS_EVENT/);
  assert.doesNotMatch(keepAliveSource, /\b(?:stop|abort)Agent/);
  // 状态端点对有效会话续期（保活能真正延长过期时间）
  assert.match(statusRouteSource, /touchAuthenticatedSession\(request\)/);
});
