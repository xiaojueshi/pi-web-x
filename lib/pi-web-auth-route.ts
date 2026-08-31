/**
 * pi-web-x Web 访问认证的 HTTP 辅助层。
 *
 * 移植自上游 pi-web PR #289（lib/pi-web-auth-route.ts）：
 * 请求体大小限制、JSON 校验、会话 cookie 构造、会话 token 提取与限流 key。
 * cookie 名按 pi-web-x 断裂命名规范更名，环境变量用 PI_WEB_X_* 前缀。
 */

import { getSession } from "./pi-web-auth";

/** 认证变更请求体大小上限（16 KB）。 */
const MAX_BODY_BYTES = 16 * 1024;
/** 会话 cookie 名（HttpOnly、SameSite=Lax）。 */
export const PI_WEB_X_SESSION_COOKIE = "pi_web_x_session";

/**
 * 校验认证变更请求的 JSON 头（无 body 场景）。
 * @param request 当前 HTTP 请求
 * @throws Content-Type 非法时抛出带 status 的 Error（415）
 */
export function validateAuthJsonHeaders(request: Request): void {
  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    throw Object.assign(new Error("Content-Type must be application/json"), {
      status: 415,
    });
  }
}

/**
 * 返回格式一致的认证错误响应。
 * @param errorCode 暴露给客户端、稳定不变的错误码
 * @param message 面向旧客户端的非敏感错误消息
 * @param status HTTP 状态码
 * @returns JSON 错误响应
 */
export function authError(
  errorCode: string,
  message: string,
  status: number,
): Response {
  return Response.json({ errorCode, error: message }, { status });
}

/**
 * 读取并校验认证 API 的 JSON 请求体。
 * @param request 当前 HTTP 请求
 * @param options 是否允许缺失/空 body
 * @returns 解析后的 JSON 对象
 * @throws 非 JSON、超限或结构非法时抛出带 status 的 Error
 */
export async function readAuthJson(
  request: Request,
  options: { allowEmpty?: boolean } = {},
): Promise<Record<string, unknown>> {
  const hasBody = request.body !== null;
  if (!hasBody && options.allowEmpty) return {};
  validateAuthJsonHeaders(request);
  const reader = request.body?.getReader();
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_BODY_BYTES) {
          await reader.cancel();
          throw Object.assign(new Error("Request body is too large"), {
            status: 413,
          });
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  }
  const text = new TextDecoder().decode(concatChunks(chunks, bytes));
  if (!text.trim() && options.allowEmpty) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Request body must be valid JSON"), {
      status: 400,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("Invalid request body format"), {
      status: 400,
    });
  }
  return parsed as Record<string, unknown>;
}

/** 合并请求体分块（不预先分配无界缓冲）。 */
function concatChunks(chunks: Uint8Array[], byteLength: number): Uint8Array {
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/**
 * 从请求 cookie 中提取会话 token。
 * @param request 当前 HTTP 请求
 * @returns 原始会话 token，缺失时返回 null
 */
export function getSessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(
    new RegExp(`(?:^|;\\s*)${PI_WEB_X_SESSION_COOKIE}=([^;]*)`),
  );
  return match?.[1] || null;
}

/**
 * 校验当前请求的认证会话。
 * @param request 当前 HTTP 请求
 * @returns 会话 token 与校验结果
 */
export function getAuthenticatedSession(request: Request): {
  token: string;
  valid: boolean;
} {
  const token = getSessionToken(request);
  return { token: token ?? "", valid: token ? getSession(token).valid : false };
}

/**
 * 生成认证会话 cookie 的 Set-Cookie 头值。
 * @param request 当前 HTTP 请求（判定 https）
 * @param token cookie 值；null 表示清除
 * @returns Set-Cookie 头值
 */
export function sessionCookie(request: Request, token: string | null): string {
  let isHttps = false;
  try {
    isHttps =
      new URL(request.url).protocol === "https:" ||
      request.headers.get("x-forwarded-proto") === "https";
  } catch {
    isHttps = false;
  }
  const secure = isHttps ? "; Secure" : "";
  const age = token ? "86400" : "0";
  const value = token ?? "";
  return `${PI_WEB_X_SESSION_COOKIE}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${secure}`;
}

/**
 * 计算登录限流的来源 key（不把代理头当身份）。
 * @param request 当前 HTTP 请求
 * @returns 限流桶 key
 */
export function loginRateKey(request: Request): string {
  if (process.env.PI_WEB_X_TRUSTED_PROXY === "true") {
    return (
      request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() ||
      request.headers.get("x-real-ip")?.trim() ||
      "anonymous"
    );
  }
  return "anonymous";
}