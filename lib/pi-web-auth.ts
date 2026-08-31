/**
 * pi-web-x Web 访问认证核心。
 *
 * 移植自上游 pi-web PR #289（feat/auth-settings-center，作者本人，已关闭未合并）：
 * scrypt 密码哈希 + 一次性 setup token + 内存会话（仅存哈希）+ 登录限流 + 改密全量作废。
 * 按 pi-web-x 规范 Bun 原生改造：哈希用 Bun.CryptoHasher，认证数据默认落
 * `~/.pi-web-x/auth/pi-web-auth.json`（User Data Root），环境变量用 PI_WEB_X_* 前缀。
 */

import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { lstatSync, readFileSync } from "node:fs";
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** promisify 的 scrypt：Bun 运行时完整支持 node:crypto scrypt。 */
const scrypt = (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: typeof SCRYPT_CONFIG,
): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey as Buffer);
    });
  });

/** 会话过期时间（24 小时）。 */
const SESSION_TTL = 24 * 60 * 60 * 1000;
/** 单来源登录失败次数上限（限流窗口内）。 */
const SOURCE_FAILURE_LIMIT = 5;
/** 全局登录失败次数上限（限流窗口内）。 */
const GLOBAL_FAILURE_LIMIT = 100;
/** 并发登录尝试上限。 */
const MAX_CONCURRENT_LOGIN_ATTEMPTS = 4;
/** 登录限流窗口（15 分钟）。 */
const RATE_LIMIT_WINDOW = 15 * 60 * 1000;
/** 密码最短长度。 */
const PASSWORD_MIN_LENGTH = 8;
/** 密码最长长度。 */
const PASSWORD_MAX_LENGTH = 128;
/** scrypt 参数（与 PR #289 一致）。 */
const SCRYPT_CONFIG = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 32 * 1024 * 1024,
} as const;
/** 常见弱密码黑名单。 */
const COMMON_WEAK_PASSWORDS = new Set([
  "password",
  "password1",
  "12345678",
  "qwertyui",
  "letmein",
  "admin",
]);

/** 认证配置文件结构。 */
interface StoredAuthConfig {
  /** 哈希算法；当前仅支持 scrypt。 */
  algorithm?: "scrypt";
  /** 算法版本。 */
  algorithmVersion?: 1;
  /** scrypt 参数（旧版无此字段时回退默认）。 */
  scrypt?: typeof SCRYPT_CONFIG;
  /** 密码哈希（hex）。 */
  passwordHash: string;
  /** 盐（hex）。 */
  salt: string;
  /** 密码代次；改密时递增。 */
  generation: number;
  /** 最后更新时间（ISO 8601）。 */
  updatedAt: string;
}

/** 不携带密码凭据、暴露给调用方的认证状态。 */
export interface AuthState {
  /** 认证是否已完成首次设置。 */
  initialized: boolean;
  /** 当前密码代次。 */
  generation: number;
  /** 配置最后更新时间。 */
  updatedAt?: string;
}

/** 会话校验结果。 */
export interface SessionValidation {
  /** 会话是否有效。 */
  valid: boolean;
  /** 该会话对应的密码代次。 */
  generation?: number;
}

/** 登录限流决策。 */
export interface RateLimitDecision {
  /** 当前请求是否允许继续。 */
  allowed: boolean;
  /** 拒绝时的建议等待毫秒数。 */
  retryAfterMs?: number;
  /** 放行前的渐进式延迟毫秒数。 */
  delayMs?: number;
}

/** 内存会话记录。 */
interface SessionRecord {
  /** 会话 token 的 SHA-256 哈希。 */
  hash: string;
  /** 创建时间戳。 */
  createdAt: number;
  /** 过期时间戳。 */
  expiresAt: number;
  /** 创建时的密码代次。 */
  generation: number;
}

/** 会话失效监听回调。 */
type SessionInvalidationListener = () => void;

/** 认证运行时状态（挂在 globalThis 上，跨 Bun 热重载存续）。 */
interface AuthRuntimeState {
  sessionInvalidationListeners: Map<
    string,
    Set<SessionInvalidationListener>
  >;
  sessionInvalidationTimeouts: Map<string, ReturnType<typeof setTimeout>>;
  loginFailures: Map<string, { count: number; firstFailureAt: number }>;
  globalLoginFailures: { count: number; firstFailureAt: number } | null;
  activeLoginAttempts: number;
  authMutationQueue: Promise<void>;
  authGeneration: number;
  generationInitialized: boolean;
  initializationInProgress: boolean;
}

declare global {
  var __piWebAuthSetupState:
    | { token: string | null; announced: boolean }
    | undefined;
  var __piWebAuthSessions: Map<string, SessionRecord> | undefined;
  var __piWebAuthRuntime: AuthRuntimeState | undefined;
}

const sessions = (globalThis.__piWebAuthSessions ??= new Map<
  string,
  SessionRecord
>());
const runtime: AuthRuntimeState = (globalThis.__piWebAuthRuntime ??= {
  sessionInvalidationListeners: new Map(),
  sessionInvalidationTimeouts: new Map(),
  loginFailures: new Map(),
  globalLoginFailures: null,
  activeLoginAttempts: 0,
  authMutationQueue: Promise.resolve(),
  authGeneration: 1,
  generationInitialized: false,
  initializationInProgress: false,
});
runtime.activeLoginAttempts ??= 0;
const sessionInvalidationListeners = runtime.sessionInvalidationListeners;
const sessionInvalidationTimeouts = runtime.sessionInvalidationTimeouts;
const loginFailures = runtime.loginFailures;

/** 首次设置 token 状态：配置存在时置 null（不创凭据），否则模块首次加载时生成。 */
const setupState = (globalThis.__piWebAuthSetupState ??= {
  token: configPathExists() ? null : randomBytes(32).toString("hex"),
  announced: false,
});

/**
 * 认证配置文件路径。
 *
 * 默认位于 User Data Root：`~/.pi-web-x/auth/pi-web-auth.json`；
 * 可用环境变量 `PI_WEB_X_AUTH_CONFIG_PATH` 覆盖（测试隔离 HOME 时用）。
 */
function configPath(): string {
  return (
    process.env.PI_WEB_X_AUTH_CONFIG_PATH ||
    join(homedir(), ".pi-web-x", "auth", "pi-web-auth.json")
  );
}

/** 计算 token 的 SHA-256 哈希（Bun 原生）。 */
function hashToken(token: string): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(token);
  return hasher.digest("hex");
}

/**
 * 读取认证配置；文件缺失返回 null，损坏则抛出。
 * @returns 解析后的配置，或文件不存在时的 null
 * @throws 配置路径非普通文件或 JSON 结构非法时抛出
 */
async function readConfig(): Promise<StoredAuthConfig | null> {
  try {
    if (configPathExists() && !hasRegularConfigFile()) {
      throw new Error("Authentication config path is not a regular file");
    }
    const parsed: unknown = JSON.parse(await readFile(configPath(), "utf8"));
    validateConfig(parsed);
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** 初始化专用读取：语义与 readConfig 一致（保留独立函数以便测试注入）。 */
async function readConfigForInitialization(): Promise<StoredAuthConfig | null> {
  return await readConfig();
}

/** 校验配置 JSON 结构；非法时抛出。 */
function validateConfig(value: unknown): asserts value is StoredAuthConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid authentication config structure");
  }
  const config = value as Record<string, unknown>;
  const keys = Object.keys(config).sort().join(",");
  const legacy = keys === "generation,passwordHash,salt,updatedAt";
  const versioned =
    keys === "algorithm,algorithmVersion,generation,passwordHash,salt,scrypt,updatedAt";
  if (
    (!legacy && !versioned) ||
    (versioned &&
      (config.algorithm !== "scrypt" ||
        config.algorithmVersion !== 1 ||
        !isScryptConfig(config.scrypt))) ||
    typeof config.passwordHash !== "string" ||
    !/^[0-9a-f]+$/i.test(config.passwordHash) ||
    config.passwordHash.length !== 128 ||
    typeof config.salt !== "string" ||
    !/^[0-9a-f]+$/i.test(config.salt) ||
    config.salt.length !== 32 ||
    typeof config.generation !== "number" ||
    !Number.isSafeInteger(config.generation) ||
    config.generation < 1 ||
    typeof config.updatedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(config.updatedAt) ||
    !Number.isFinite(Date.parse(config.updatedAt))
  ) {
    throw new Error("Invalid authentication config structure");
  }
}

/** 判断对象是否恰好等于默认 scrypt 参数（防配置篡改）。 */
function isScryptConfig(value: unknown): value is typeof SCRYPT_CONFIG {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).N === SCRYPT_CONFIG.N &&
    (value as Record<string, unknown>).r === SCRYPT_CONFIG.r &&
    (value as Record<string, unknown>).p === SCRYPT_CONFIG.p &&
    (value as Record<string, unknown>).maxmem === SCRYPT_CONFIG.maxmem
  );
}

/** 返回配置中的 scrypt 参数，非法时回退默认。 */
function getScryptConfig(config: StoredAuthConfig): typeof SCRYPT_CONFIG {
  return config.scrypt && isScryptConfig(config.scrypt)
    ? config.scrypt
    : SCRYPT_CONFIG;
}

/** 校验密码强度：长度 8-128、非全同字符、非弱密码黑名单。 */
function validatePassword(password: string): void {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH ||
    /^([\s\S])\1+$/.test(password) ||
    COMMON_WEAK_PASSWORDS.has(password.toLowerCase())
  ) {
    throw new Error("Invalid password format");
  }
}

/** 配置路径是否为普通文件（非目录/符号链接等）。 */
function hasRegularConfigFile(): boolean {
  try {
    return lstatSync(configPath()).isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** 配置路径是否存在。 */
function configPathExists(): boolean {
  try {
    lstatSync(configPath());
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/**
 * 原子写配置：临时文件 + chmod 0600 + rename。
 * @param config 要持久化的配置
 */
async function writeConfig(config: StoredAuthConfig): Promise<void> {
  const path = configPath();
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(config)}\n`, {
      mode: 0o600,
    });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }
}

/** 返回实际认证配置文件路径（供日志/诊断）。 */
export function getAuthConfigPath(): string {
  return configPath();
}

/**
 * 在服务器启动时打印一次性 setup token（option A）：不落盘、不暴露 HTTP。
 *
 * 配置已存在时仅校验有效性；损坏时打印拒绝自动重置的提示。
 */
export function announceSetupToken(): void {
  if (setupState.announced) return;
  if (configPathExists()) {
    try {
      if (!hasRegularConfigFile()) {
        throw new Error(
          "Authentication config path is not a regular file",
        );
      }
      validateConfig(JSON.parse(readFileSync(configPath(), "utf8")));
    } catch {
      setupState.announced = true;
      console.error(
        `[pi-web-x] Authentication config is corrupt; refusing automatic reset. Stop the service, then back up or repair the config file: ${configPath()}`,
      );
    }
    return;
  }
  if (setupState.token === null) return;
  setupState.announced = true;
  console.error(`[pi-web-x] Pi Web X setup token: ${setupState.token}`);
}

/**
 * 读取认证状态（不含凭据）；配置损坏时抛出。
 * @returns 初始化状态与当前密码代次
 * @throws 配置读取失败或 JSON 损坏时抛出
 */
export async function getAuthState(): Promise<AuthState> {
  await runtime.authMutationQueue;
  const config = await readConfig();
  if (!config) return { initialized: false, generation: 0 };
  return {
    initialized: true,
    generation: config.generation,
    updatedAt: config.updatedAt,
  };
}

/**
 * 用一次性 setup token 设置密码并持久化认证配置。
 * @param token 一次性 setup token
 * @param password 要设置的密码
 * @throws token 无效、认证已初始化或写入失败时抛出
 */
export async function initializeAuth(
  token: string,
  password: string,
): Promise<void> {
  const operation = runtime.authMutationQueue.then(
    () => initializeAuthNow(token, password),
    () => initializeAuthNow(token, password),
  );
  runtime.authMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

/** initializeAuth 的实际执行体（串行化，防并发覆盖）。 */
async function initializeAuthNow(token: string, password: string): Promise<void> {
  if (runtime.initializationInProgress) {
    throw new Error("Authentication setup is already in progress");
  }
  runtime.initializationInProgress = true;
  let tokenConsumed = false;
  let writeAttempted = false;
  let configWriteCompleted = false;
  try {
    validatePassword(password);
    const existing = await readConfigForInitialization();
    if (existing) throw new Error("Authentication is already initialized");
    if (!consumeSetupToken(token)) throw new Error("Invalid setup token");
    tokenConsumed = true;
    const salt = randomBytes(16);
    const derived = (await scrypt(
      password,
      salt,
      64,
      SCRYPT_CONFIG,
    )) as Buffer;
    // 昂贵的哈希后复查，阻止并发请求覆盖配置
    if (await readConfigForInitialization()) {
      throw new Error("Authentication is already initialized");
    }
    writeAttempted = true;
    await writeConfig({
      algorithm: "scrypt",
      algorithmVersion: 1,
      scrypt: SCRYPT_CONFIG,
      passwordHash: derived.toString("hex"),
      salt: salt.toString("hex"),
      generation: runtime.authGeneration + 1,
      updatedAt: new Date().toISOString(),
    });
    configWriteCompleted = true;
    sessions.clear();
    notifyAllSessionInvalidations();
    bumpGeneration();
  } catch (error) {
    if (tokenConsumed && writeAttempted && !configWriteCompleted) {
      setupState.token = token;
    }
    throw error;
  } finally {
    runtime.initializationInProgress = false;
  }
}

/**
 * 校验密码；配置缺失返回 false，配置损坏抛出。
 * @param password 待校验密码
 * @returns 密码是否匹配
 * @throws 配置读取失败或损坏时抛出
 */
export async function verifyPassword(password: string): Promise<boolean> {
  return await runtime.authMutationQueue.then(
    () => verifyPasswordNow(password),
    () => verifyPasswordNow(password),
  );
}

/** verifyPassword 的实际执行体。 */
async function verifyPasswordNow(password: string): Promise<boolean> {
  const config = await readConfig();
  if (!config) return false;
  const expected = Buffer.from(config.passwordHash, "hex");
  const actual = (await scrypt(
    password,
    Buffer.from(config.salt, "hex"),
    expected.length,
    getScryptConfig(config),
  )) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * 校验密码并串行创建会话（避免与改密交错）。
 * @param password 待校验密码
 * @returns 成功返回会话 token，失败返回 null
 */
export async function authenticateAndCreateSession(
  password: string,
): Promise<string | null> {
  const operation = runtime.authMutationQueue.then(async () => {
    const config = await readConfig();
    if (!config || !(await verifyPasswordNow(password))) return null;
    return createSessionForGeneration(config.generation);
  }, async () => null);
  runtime.authMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

/**
 * 原子更新密码并作废全部已有会话。
 * @param currentPassword 当前密码
 * @param newPassword 新密码
 * @throws 当前密码错误、认证未初始化或写入失败时抛出；写入失败保持旧密码不变
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const operation = runtime.authMutationQueue.then(
    () => changePasswordNow(currentPassword, newPassword),
    () => changePasswordNow(currentPassword, newPassword),
  );
  runtime.authMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

/** changePassword 的实际执行体。 */
async function changePasswordNow(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  validatePassword(newPassword);
  const config = await readConfig();
  if (!config) throw new Error("Authentication is not initialized");
  const expected = Buffer.from(config.passwordHash, "hex");
  const actual = (await scrypt(
    currentPassword,
    Buffer.from(config.salt, "hex"),
    expected.length,
    getScryptConfig(config),
  )) as Buffer;
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Current password is incorrect");
  }
  const salt = randomBytes(16);
  const derived = (await scrypt(newPassword, salt, 64, SCRYPT_CONFIG)) as Buffer;
  await writeConfig({
    ...config,
    algorithm: "scrypt",
    algorithmVersion: 1,
    scrypt: SCRYPT_CONFIG,
    passwordHash: derived.toString("hex"),
    salt: salt.toString("hex"),
    generation: config.generation + 1,
    updatedAt: new Date().toISOString(),
  });
  sessions.clear();
  notifyAllSessionInvalidations();
  runtime.authGeneration = config.generation + 1;
  runtime.generationInitialized = true;
}

/**
 * 创建会话（按当前密码代次）；返回的原始 token 只进 cookie。
 * @returns 随机会话 token
 */
export function createSession(): string {
  const token = randomBytes(32).toString("hex");
  const now = Date.now();
  const stateGeneration = currentGeneration();
  return storeSession(token, now, stateGeneration);
}

/** 按指定密码代次创建会话。 */
function createSessionForGeneration(stateGeneration: number): string {
  const token = randomBytes(32).toString("hex");
  return storeSession(token, Date.now(), stateGeneration);
}

/** 存储会话（仅存 token 哈希）并返回原始 token。 */
function storeSession(
  token: string,
  now: number,
  stateGeneration: number,
): string {
  const tokenHash = hashToken(token);
  sessions.set(tokenHash, {
    hash: tokenHash,
    createdAt: now,
    expiresAt: now + SESSION_TTL,
    generation: stateGeneration,
  });
  return token;
}

/**
 * 校验会话存在性、过期与密码代次。
 * @param token 待校验的原始会话 token
 * @returns 会话校验结果
 */
export function getSession(token: string): SessionValidation {
  const record = sessions.get(hashToken(token));
  if (
    !record ||
    record.expiresAt <= Date.now() ||
    record.generation !== currentGeneration()
  ) {
    if (record) sessions.delete(record.hash);
    return { valid: false };
  }
  return { valid: true, generation: record.generation };
}

/**
 * 滑动续期会话：有效会话把过期时间重置为 now + SESSION_TTL。
 *
 * 页面保活 / 活跃请求调用，实现“页面开启期间会话不掉线”；
 * 无效、已过期或密码代次不符的会话不续期（保持原失效语义）。
 *
 * @param token 原始会话 token
 * @returns 会话是否有效并已完成续期
 */
export function touchSession(token: string): boolean {
  if (!token) return false;
  const tokenHash = hashToken(token);
  const record = sessions.get(tokenHash);
  if (
    !record ||
    record.expiresAt <= Date.now() ||
    record.generation !== currentGeneration()
  ) {
    if (record) sessions.delete(record.hash);
    return false;
  }
  record.expiresAt = Date.now() + SESSION_TTL;
  rescheduleSessionInvalidation(tokenHash);
  return true;
}

/**
 * 递增密码代次、持久化并作废全部会话。
 * @throws 配置读写失败时抛出；内存代次与会话在失败时保持不变
 */
export async function revokeAllSessions(): Promise<void> {
  const operation = runtime.authMutationQueue.then(
    revokeAllSessionsNow,
    revokeAllSessionsNow,
  );
  runtime.authMutationQueue = operation.then(() => undefined, () => undefined);
  return operation;
}

/** revokeAllSessions 的实际执行体。 */
async function revokeAllSessionsNow(): Promise<void> {
  const previousGeneration = runtime.authGeneration;
  const previousInitialization = runtime.generationInitialized;
  const config = syncGenerationFromConfig();
  if (!config) {
    sessions.clear();
    notifyAllSessionInvalidations();
    bumpGeneration();
    return;
  }

  const nextGeneration = config.generation + 1;
  try {
    await writeConfig({
      ...config,
      generation: nextGeneration,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    runtime.authGeneration = previousGeneration;
    runtime.generationInitialized = previousInitialization;
    throw error;
  }
  sessions.clear();
  notifyAllSessionInvalidations();
  runtime.authGeneration = nextGeneration;
  runtime.generationInitialized = true;
}

/**
 * 作废指定会话。
 * @param token 原始会话 token
 */
export function revokeSession(token: string): void {
  const tokenHash = hashToken(token);
  sessions.delete(tokenHash);
  notifySessionInvalidation(tokenHash);
}

/**
 * 订阅会话失效事件（不触碰 AgentSession 生命周期）。
 * @param token 原始 Web 会话 token
 * @param listener 会话失效回调
 * @returns 可重复调用的退订函数
 */
export function subscribeSessionInvalidation(
  token: string,
  listener: SessionInvalidationListener,
): () => void {
  const tokenHash = hashToken(token);
  const record = sessions.get(tokenHash);
  if (
    !record ||
    record.expiresAt <= Date.now() ||
    record.generation !== currentGeneration()
  ) {
    listener();
    return () => {};
  }
  let listeners = sessionInvalidationListeners.get(tokenHash);
  if (!listeners) {
    listeners = new Set();
    sessionInvalidationListeners.set(tokenHash, listeners);
  }
  listeners.add(listener);
  if (!sessionInvalidationTimeouts.has(tokenHash)) {
    const timeout = setTimeout(
      () => notifySessionInvalidation(tokenHash),
      Math.max(0, record.expiresAt - Date.now()),
    );
    sessionInvalidationTimeouts.set(tokenHash, timeout);
  }
  const unsubscribe = () => {
    const current = sessionInvalidationListeners.get(tokenHash);
    current?.delete(listener);
    if (current?.size === 0) {
      sessionInvalidationListeners.delete(tokenHash);
      clearTimeout(sessionInvalidationTimeouts.get(tokenHash));
      sessionInvalidationTimeouts.delete(tokenHash);
    }
  };
  return unsubscribe;
}

/** 重排会话失效通知定时器（滑动续期后调用，避免提前触发过期通知）。 */
function rescheduleSessionInvalidation(tokenHash: string): void {
  const existing = sessionInvalidationTimeouts.get(tokenHash);
  if (existing === undefined) return;
  clearTimeout(existing);
  const record = sessions.get(tokenHash);
  if (!record) {
    sessionInvalidationTimeouts.delete(tokenHash);
    return;
  }
  sessionInvalidationTimeouts.set(
    tokenHash,
    setTimeout(
      () => notifySessionInvalidation(tokenHash),
      Math.max(0, record.expiresAt - Date.now()),
    ),
  );
}

/** 通知指定会话已失效，清理监听与超时。 */
function notifySessionInvalidation(tokenHash: string): void {
  clearTimeout(sessionInvalidationTimeouts.get(tokenHash));
  sessionInvalidationTimeouts.delete(tokenHash);
  const listeners = sessionInvalidationListeners.get(tokenHash);
  if (!listeners) return;
  sessionInvalidationListeners.delete(tokenHash);
  for (const listener of listeners) listener();
}

/** 通知全部会话失效。 */
function notifyAllSessionInvalidations(): void {
  for (const tokenHash of sessionInvalidationListeners.keys()) {
    notifySessionInvalidation(tokenHash);
  }
}

/**
 * 消费一次性 setup token；成功后从内存移除。
 * @param token 待消费的 setup token
 * @returns token 是否有效且被消费
 */
export function consumeSetupToken(token: string): boolean {
  if (configPathExists()) {
    setupState.token = null;
    return false;
  }
  if (setupState.token === null || token !== setupState.token) return false;
  setupState.token = null;
  return true;
}

/**
 * 判断来源是否仍可尝试登录。
 * @param key 登录来源标识
 * @returns 限流决策与建议延迟
 */
export function checkLoginRateLimit(key: string): RateLimitDecision {
  const now = Date.now();
  for (const [source, failure] of loginFailures) {
    if (now - failure.firstFailureAt >= RATE_LIMIT_WINDOW) {
      loginFailures.delete(source);
    }
  }
  const globalFailure = runtime.globalLoginFailures;
  if (
    globalFailure &&
    now - globalFailure.firstFailureAt >= RATE_LIMIT_WINDOW
  ) {
    runtime.globalLoginFailures = null;
  }
  const activeFailure = loginFailures.get(key);
  if (
    key !== "anonymous" &&
    activeFailure &&
    activeFailure.count >= SOURCE_FAILURE_LIMIT
  ) {
    return {
      allowed: false,
      retryAfterMs: RATE_LIMIT_WINDOW - (now - activeFailure.firstFailureAt),
    };
  }
  const activeGlobalFailure = runtime.globalLoginFailures;
  if (
    activeGlobalFailure &&
    activeGlobalFailure.count >= GLOBAL_FAILURE_LIMIT
  ) {
    return {
      allowed: false,
      retryAfterMs:
        RATE_LIMIT_WINDOW - (now - activeGlobalFailure.firstFailureAt),
    };
  }
  return {
    allowed: true,
    delayMs: activeFailure
      ? Math.min(activeFailure.count * 100, 500)
      : 0,
  };
}

/**
 * 密码校验前原子保留一次登录尝试名额。
 * @param key 登录来源标识
 * @returns 限流决策；并发超限时拒绝
 */
export function beginLoginAttempt(key: string): RateLimitDecision {
  const decision = checkLoginRateLimit(key);
  if (!decision.allowed) return decision;
  if (runtime.activeLoginAttempts >= MAX_CONCURRENT_LOGIN_ATTEMPTS) {
    return { allowed: false, retryAfterMs: 1000 };
  }
  runtime.activeLoginAttempts += 1;
  return decision;
}

/**
 * 释放登录尝试名额并按需记录失败。
 * @param key 登录来源标识
 * @param failed 凭据校验是否失败
 */
export function finishLoginAttempt(key: string, failed: boolean): void {
  runtime.activeLoginAttempts = Math.max(0, runtime.activeLoginAttempts - 1);
  if (failed) recordLoginFailure(key);
}

/**
 * 记录一次登录失败（来源计数 + 全局计数）。
 * @param key 登录来源标识
 */
export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const existing = loginFailures.get(key);
  if (!existing || now - existing.firstFailureAt >= RATE_LIMIT_WINDOW) {
    loginFailures.set(key, { count: 1, firstFailureAt: now });
  } else {
    existing.count += 1;
  }
  if (
    !runtime.globalLoginFailures ||
    now - runtime.globalLoginFailures.firstFailureAt >= RATE_LIMIT_WINDOW
  ) {
    runtime.globalLoginFailures = { count: 1, firstFailureAt: now };
  } else {
    runtime.globalLoginFailures.count += 1;
  }
}

/** 当前密码代次；未初始化时先同步配置文件。 */
function currentGeneration(): number {
  if (!runtime.generationInitialized) syncGenerationFromConfig();
  return runtime.authGeneration;
}

/** 从配置同步内存密码代次（同步读取，供会话校验路径使用）。 */
function syncGenerationFromConfig(): StoredAuthConfig | null {
  try {
    if (configPathExists() && !hasRegularConfigFile()) {
      throw new Error("Authentication config path is not a regular file");
    }
    const content = readFileSync(configPath(), "utf8");
    const parsed: unknown = JSON.parse(content);
    validateConfig(parsed);
    runtime.authGeneration = parsed.generation;
    runtime.generationInitialized = true;
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      runtime.generationInitialized = true;
      return null;
    }
    throw error;
  }
}

/** 内存密码代次 +1（仅在初始化/撤销路径调用）。 */
function bumpGeneration(): void {
  runtime.authGeneration += 1;
}

/**
 * 仅测试用：重置认证状态并删除测试配置。
 * @throws 删除测试配置失败时抛出
 */
export async function resetAuthStateForTests(): Promise<void> {
  sessions.clear();
  notifyAllSessionInvalidations();
  loginFailures.clear();
  runtime.globalLoginFailures = null;
  runtime.activeLoginAttempts = 0;
  setupState.token = "setup-token";
  setupState.announced = false;
  runtime.authGeneration = 1;
  runtime.generationInitialized = false;
  runtime.initializationInProgress = false;
  runtime.authMutationQueue = Promise.resolve();
  await unlink(configPath()).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

/**
 * 仅测试用：返回当前进程 setup token 以校验熵。
 * @returns setup token
 * @throws 配置损坏、已初始化或 token 不可用时抛出
 */
export function getSetupTokenForTests(): string {
  if (configPathExists() && !hasRegularConfigFile()) {
    throw new Error("Authentication config is corrupt");
  }
  if (hasRegularConfigFile()) {
    throw new Error("Authentication is already initialized");
  }
  if (setupState.token === null) throw new Error("Setup token is unavailable");
  return setupState.token;
}

/**
 * 仅测试用：返回会话的过期时间戳（用于断言滑动续期延长过期时间）。
 * @param token 原始会话 token
 * @returns 过期时间戳；会话不存在时返回 null
 */
export function getSessionExpiryForTests(token: string): number | null {
  const record = sessions.get(hashToken(token));
  return record ? record.expiresAt : null;
}