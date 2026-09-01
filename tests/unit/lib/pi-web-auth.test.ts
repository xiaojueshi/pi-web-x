import assert from "node:assert/strict";
import { afterEach, beforeEach, setSystemTime, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 认证核心测试：每个用例用独立 HOME 下的配置文件，避免污染真实用户数据。
// 模块顶层 setupState.token 在首次 import 时按 configPathExists() 快照生成，
// 因此每轮测试前删除临时配置目录并 resetAuthStateForTests()。

let authDir: string;
let authConfigPath: string;

/** 重新加载模块并重置认证状态（token 固定为 "setup-token"）。 */
async function loadAuth(): Promise<
  typeof import("../../../lib/pi-web-auth.ts")
> {
  const mod = await import("../../../lib/pi-web-auth.ts");
  await mod.resetAuthStateForTests();
  return mod;
}

beforeEach(() => {
  authDir = mkdtempSync(join(tmpdir(), "pi-web-auth-test-"));
  authConfigPath = join(authDir, "auth", "pi-web-auth.json");
  process.env.PI_WEB_X_AUTH_CONFIG_PATH = authConfigPath;
});

afterEach(() => {
  delete process.env.PI_WEB_X_AUTH_CONFIG_PATH;
  rmSync(authDir, { recursive: true, force: true });
});

test("未初始化时无配置、setup token 可读", async () => {
  const mod = await loadAuth();
  const state = await mod.getAuthState();
  assert.equal(state.initialized, false);
  assert.equal(state.generation, 0);
  // resetAuthStateForTests() 固定为 setup-token
  assert.equal(mod.getSetupTokenForTests(), "setup-token");
});

test("用 setup token 初始化密码：写盘、代次递增、会话作废", async () => {
  const mod = await loadAuth();
  const token = mod.getSetupTokenForTests();
  await mod.initializeAuth(token, "test-password-123");
  const state = await mod.getAuthState();
  assert.equal(state.initialized, true);
  assert.ok(state.generation >= 1);
  // 二次初始化应拒绝
  await assert.rejects(
    () => mod.initializeAuth("setup-token", "another-password-456"),
    /already initialized/,
  );
});

test("密码校验：正确密码通过、错误密码拒绝、未初始化拒绝", async () => {
  const mod = await loadAuth();
  assert.equal(await mod.verifyPassword("whatever-password"), false);
  const token = mod.getSetupTokenForTests();
  await mod.initializeAuth(token, "test-password-123");
  assert.equal(await mod.verifyPassword("test-password-123"), true);
  assert.equal(await mod.verifyPassword("wrong-password"), false);
});

test("会话：创建有效、错误 token 无效、过期后无效", async () => {
  const mod = await loadAuth();
  const token = mod.getSetupTokenForTests();
  await mod.initializeAuth(token, "test-password-123");
  const sessionToken = mod.createSession();
  assert.equal(mod.getSession(sessionToken).valid, true);
  assert.equal(mod.getSession("nonsense-token").valid, false);
  // 撤销单个会话
  await mod.revokeSession(sessionToken);
  assert.equal(mod.getSession(sessionToken).valid, false);
});

test("登录成功后会话可用，错误密码返回 null", async () => {
  const mod = await loadAuth();
  const token = mod.getSetupTokenForTests();
  await mod.initializeAuth(token, "test-password-123");
  const sessionToken =
    await mod.authenticateAndCreateSession("test-password-123");
  assert.ok(sessionToken !== null);
  assert.equal(mod.getSession(sessionToken).valid, true);
  assert.equal(
    existsSync(join(authDir, "auth", "pi-web-sessions.json")),
    true,
    "登录返回前应已完成会话持久化",
  );
  const badSession = await mod.authenticateAndCreateSession("wrong-password");
  assert.equal(badSession, null);
});

test("改密：旧会话作废、新密码生效、旧密码失效", async () => {
  const mod = await loadAuth();
  const token = mod.getSetupTokenForTests();
  await mod.initializeAuth(token, "test-password-123");
  const sessionToken =
    await mod.authenticateAndCreateSession("test-password-123");
  assert.ok(sessionToken !== null);
  await mod.changePassword("test-password-123", "new-password-456");
  // 旧会话被全量作废
  assert.equal(mod.getSession(sessionToken).valid, false);
  // 新密码有效
  assert.equal(await mod.verifyPassword("new-password-456"), true);
  assert.equal(await mod.verifyPassword("test-password-123"), false);
  // 错误当前密码拒绝改密
  await assert.rejects(
    () => mod.changePassword("wrong-current", "yet-another-789"),
    /Current password is incorrect/,
  );
});

test("限流：具名源 5 次失败后拒绝，匿名源仅受全局限", async () => {
  const mod = await loadAuth();
  const token = mod.getSetupTokenForTests();
  await mod.initializeAuth(token, "test-password-123");
  // 具名来源：源级阈值 5
  for (let i = 0; i < 5; i += 1) mod.recordLoginFailure("127.0.0.1");
  const decision = mod.checkLoginRateLimit("127.0.0.1");
  assert.equal(decision.allowed, false);
  assert.ok((decision.retryAfterMs ?? 0) > 0);
  // 匿名源：不适用源级限制
  const anonymous = mod.checkLoginRateLimit("anonymous");
  assert.equal(anonymous.allowed, true);
});

test("弱密码：长度不足与常见弱密码被拒绝", async () => {
  const mod = await loadAuth();
  const token = mod.getSetupTokenForTests();
  await assert.rejects(
    () => mod.initializeAuth(token, "short"),
    /Invalid password format/,
  );
  await assert.rejects(
    () => mod.initializeAuth(token, "password1"),
    /Invalid password format/,
  );
});

test("setup token 消费一次即失效", async () => {
  const mod = await loadAuth();
  mod.getSetupTokenForTests();
  assert.equal(mod.consumeSetupToken("setup-token"), true);
  // 消费后再次消费失败；未初始化但 token 已无 → 初始化失败
  assert.equal(mod.consumeSetupToken("setup-token"), false);
});

test("会话滑动续期：有效会话延长过期时间，无效/错误/撤销会话不续期", async () => {
  const mod = await loadAuth();
  const token = mod.getSetupTokenForTests();
  await mod.initializeAuth(token, "test-password-123");
  const sessionToken = mod.createSession();
  const before = mod.getSessionExpiryForTests(sessionToken);
  assert.ok(before !== null);
  const realNow = Date.now();
  try {
    // 快进到会话只剩 5 秒到期：此时仍有效，但 touch 后过期点应
    // 被重置为「快进时刻 + 24h」，即远超原过期点（before + 23h）。
    setSystemTime(new Date(before - 5000));
    assert.equal(mod.getSession(sessionToken).valid, true);
    assert.equal(mod.touchSession(sessionToken), true);
    const after = mod.getSessionExpiryForTests(sessionToken);
    assert.ok(after !== null && after > before + 23 * 60 * 60 * 1000);
    // 续期后会话仍有效
    assert.equal(mod.getSession(sessionToken).valid, true);
  } finally {
    setSystemTime(new Date(realNow));
  }
  // 无 token / 错误 token 不续期
  assert.equal(mod.touchSession(""), false);
  assert.equal(mod.touchSession("nonsense-token"), false);
  // 撤销后不续期
  await mod.revokeSession(sessionToken);
  assert.equal(mod.touchSession(sessionToken), false);
});

test("会话滑动续期路由助手：有效会话产出新 Set-Cookie，无效会话返回 null", async () => {
  const auth = await loadAuth();
  const token = auth.getSetupTokenForTests();
  await auth.initializeAuth(token, "test-password-123");
  const route = await import("../../../lib/pi-web-auth-route.ts");
  const sessionToken = auth.createSession();
  // 无 cookie → null
  assert.equal(
    route.touchAuthenticatedSession(
      new Request("http://127.0.0.1:25432/api/auth/status"),
    ),
    null,
  );
  // 有效会话 → 续期 + 新的 Set-Cookie（Max-Age=86400，无 https 时不带 Secure）
  const withSession = route.touchAuthenticatedSession(
    new Request("http://127.0.0.1:25432/api/auth/status", {
      headers: { cookie: `pi_web_x_session=${sessionToken}` },
    }),
  );
  assert.ok(withSession !== null);
  assert.ok(withSession.startsWith("pi_web_x_session="));
  assert.ok(withSession.includes("Max-Age=86400"));
  assert.ok(!withSession.includes("; Secure"));
  // https（x-forwarded-proto）→ 带 Secure
  const httpsCookie = route.touchAuthenticatedSession(
    new Request("https://pi.xiaojueshi.top/api/auth/status", {
      headers: {
        cookie: `pi_web_x_session=${sessionToken}`,
        "x-forwarded-proto": "https",
      },
    }),
  );
  assert.ok(httpsCookie !== null && httpsCookie.includes("; Secure"));
  // 错误 token → null
  assert.equal(
    route.touchAuthenticatedSession(
      new Request("http://127.0.0.1:25432/api/auth/status", {
        headers: { cookie: "pi_web_x_session=nonsense" },
      }),
    ),
    null,
  );
});

test("会话持久化：登录落盘、模拟重启后恢复、登出后不再恢复", async () => {
  const mod = await loadAuth();
  const token = mod.getSetupTokenForTests();
  await mod.initializeAuth(token, "test-password-123");
  const sessionToken = mod.createSession();
  await mod.flushSessionPersistenceForTests();
  // 模拟进程重启：清空内存会话 → 失效；从磁盘恢复 → 重新有效
  mod.clearSessionsForTests();
  assert.equal(mod.getSession(sessionToken).valid, false);
  mod.restoreSessionsForTests();
  assert.equal(mod.getSession(sessionToken).valid, true);
  // 登出后落盘删除：清空并恢复后依然无效（不会“复活”）
  await mod.revokeSession(sessionToken);
  await mod.flushSessionPersistenceForTests();
  mod.clearSessionsForTests();
  mod.restoreSessionsForTests();
  assert.equal(mod.getSession(sessionToken).valid, false);
});

test("会话持久化：改密/全量作废后落盘，重启后旧会话不恢复", async () => {
  const mod = await loadAuth();
  const token = mod.getSetupTokenForTests();
  await mod.initializeAuth(token, "test-password-123");
  const sessionToken =
    await mod.authenticateAndCreateSession("test-password-123");
  assert.ok(sessionToken !== null);
  await mod.flushSessionPersistenceForTests();
  await mod.changePassword("test-password-123", "new-password-456");
  await mod.flushSessionPersistenceForTests();
  mod.clearSessionsForTests();
  mod.restoreSessionsForTests();
  // 改密全量作废已落盘：重启后旧会话不恢复、新密码会话可再登录
  assert.equal(mod.getSession(sessionToken).valid, false);
  const newSession = await mod.authenticateAndCreateSession("new-password-456");
  assert.ok(newSession !== null);
  assert.equal(mod.getSession(newSession).valid, true);
});
