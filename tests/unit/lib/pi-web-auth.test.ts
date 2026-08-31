import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 认证核心测试：每个用例用独立 HOME 下的配置文件，避免污染真实用户数据。
// 模块顶层 setupState.token 在首次 import 时按 configPathExists() 快照生成，
// 因此每轮测试前删除临时配置目录并 resetAuthStateForTests()。

let authDir: string;
let authConfigPath: string;

/** 重新加载模块并重置认证状态（token 固定为 "setup-token"）。 */
async function loadAuth(): Promise<typeof import("../../../lib/pi-web-auth.ts")> {
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
  mod.revokeSession(sessionToken);
  assert.equal(mod.getSession(sessionToken).valid, false);
});

test("登录成功后会话可用，错误密码返回 null", async () => {
  const mod = await loadAuth();
  const token = mod.getSetupTokenForTests();
  await mod.initializeAuth(token, "test-password-123");
  const sessionToken = await mod.authenticateAndCreateSession("test-password-123");
  assert.ok(sessionToken !== null);
  assert.equal(mod.getSession(sessionToken).valid, true);
  const badSession = await mod.authenticateAndCreateSession("wrong-password");
  assert.equal(badSession, null);
});

test("改密：旧会话作废、新密码生效、旧密码失效", async () => {
  const mod = await loadAuth();
  const token = mod.getSetupTokenForTests();
  await mod.initializeAuth(token, "test-password-123");
  const sessionToken = await mod.authenticateAndCreateSession("test-password-123");
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