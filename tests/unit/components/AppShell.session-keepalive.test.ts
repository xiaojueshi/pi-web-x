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

// 会话滑动续期：AppShell（认证通过后才渲染）启动保活，
// 保活通过轻量 /api/auth/status 触发服务端续期。
test("登录后启动会话保活，保活端点顺带滑动续期", () => {
  // AppShell 挂载保活
  assert.match(appShellSource, /useEffect\(\(\) => startSessionKeepAlive\(\), \[\]\)/);
  // 保活逻辑：定时 + 回到前台时 ping 轻量状态端点（no-store 防缓存吞请求）
  assert.match(keepAliveSource, /setInterval/);
  assert.match(keepAliveSource, /visibilitychange/);
  assert.match(keepAliveSource, /fetch\("\/api\/auth\/status", \{ cache: "no-store" \}\)/);
  // 状态端点对有效会话续期（保活能真正延长过期时间）
  assert.match(statusRouteSource, /touchAuthenticatedSession\(request\)/);
});