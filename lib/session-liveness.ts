const SESSION_LIVENESS_PROTOCOL_VERSION = 1;
export const SESSION_LIVENESS_REGISTRY_KEY = "pi-web-x:session-liveness/v1";

/** 可阻止 idle 回收的会话级后台工作提供者。 */
export interface SessionLivenessProvider {
  name: string;
  sessionId: string;
  sessionFile?: string;
  isActive(): boolean;
}

interface SessionIdentity {
  sessionId: string;
  sessionFile?: string;
}

interface SessionLivenessRegistry {
  version: typeof SESSION_LIVENESS_PROTOCOL_VERSION;
  register(provider: SessionLivenessProvider): () => void;
  hasActiveProvider(session: SessionIdentity): boolean;
}

function assertNonEmptyString(
  value: unknown,
  field: string,
): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(
      `Session liveness provider ${field} must be a non-empty string`,
    );
  }
}

function validateProvider(provider: SessionLivenessProvider): void {
  assertNonEmptyString(provider.name, "name");
  assertNonEmptyString(provider.sessionId, "sessionId");
  if (provider.sessionFile !== undefined) {
    assertNonEmptyString(provider.sessionFile, "sessionFile");
  }
  if (typeof provider.isActive !== "function") {
    throw new Error("Session liveness provider isActive must be a function");
  }
}

function createRegistry(): SessionLivenessRegistry {
  const providers = new Map<symbol, SessionLivenessProvider>();
  return {
    version: SESSION_LIVENESS_PROTOCOL_VERSION,
    register(provider) {
      validateProvider(provider);
      const token = Symbol(provider.name);
      providers.set(token, provider);
      let disposed = false;
      return () => {
        if (disposed) return;
        disposed = true;
        providers.delete(token);
      };
    },
    hasActiveProvider(session) {
      const identities = new Set(
        [session.sessionId, session.sessionFile].filter(
          (value): value is string => Boolean(value),
        ),
      );
      for (const provider of providers.values()) {
        if (
          !identities.has(provider.sessionId) &&
          (!provider.sessionFile || !identities.has(provider.sessionFile))
        ) {
          continue;
        }
        try {
          if (provider.isActive()) return true;
        } catch (error) {
          // 保活检查异常时宁可保留会话，避免中断扩展拥有的后台工作。
          console.error(
            `[pi-web-x] session liveness provider '${provider.name}' failed; preserving the session:`,
            error,
          );
          return true;
        }
      }
      return false;
    },
  };
}

function isCompatibleRegistry(
  value: unknown,
): value is SessionLivenessRegistry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SessionLivenessRegistry>;
  return (
    candidate.version === SESSION_LIVENESS_PROTOCOL_VERSION &&
    typeof candidate.register === "function" &&
    typeof candidate.hasActiveProvider === "function"
  );
}

function getRegistry(): SessionLivenessRegistry {
  const store = globalThis as Record<PropertyKey, unknown>;
  const key = Symbol.for(SESSION_LIVENESS_REGISTRY_KEY);
  const existing = store[key];
  if (isCompatibleRegistry(existing)) return existing;
  const registry = createRegistry();
  store[key] = registry;
  return registry;
}

/**
 * 注册扩展拥有的后台工作；返回值会撤销该保活声明。
 *
 * @param provider 关联 Web Session 的后台工作状态提供者。
 * @returns 用于注销提供者的函数。
 * @throws 提供者缺少有效身份或状态函数时抛出错误。
 */
export function registerSessionLivenessProvider(
  provider: SessionLivenessProvider,
): () => void {
  return getRegistry().register(provider);
}

/**
 * 判断指定 Web Session 是否仍有扩展拥有的后台工作。
 *
 * @param session 要检查的会话身份。
 * @returns 存在活跃或检查异常的提供者时为 true。
 */
export function hasActiveSessionLivenessProvider(
  session: SessionIdentity,
): boolean {
  return getRegistry().hasActiveProvider(session);
}
