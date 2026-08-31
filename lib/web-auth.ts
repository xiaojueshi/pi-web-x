import { timingSafeEqual } from "node:crypto";

export const PI_WEB_X_AUTH_USERNAME = "pi";

function hashSecret(value: string): Uint8Array {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(value);
  return hasher.digest();
}

function secretsEqual(actual: string, expected: string): boolean {
  return timingSafeEqual(hashSecret(actual), hashSecret(expected));
}

export function isWebPasswordEnabled(
  password: string | undefined = process.env.PI_WEB_X_PASSWORD,
): password is string {
  return typeof password === "string" && password.length > 0;
}

export function isValidBasicAuthorization(
  authorization: string | null,
  password = process.env.PI_WEB_X_PASSWORD,
): boolean {
  if (!isWebPasswordEnabled(password) || !authorization) return false;

  const match = /^Basic\s+(\S+)$/i.exec(authorization);
  if (!match) return false;

  let credentials: string;
  try {
    const decoded = Buffer.from(match[1], "base64");
    if (decoded.toString("base64") !== match[1]) return false;
    credentials = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch {
    return false;
  }

  const separator = credentials.indexOf(":");
  if (separator === -1) return false;

  const username = credentials.slice(0, separator);
  const suppliedPassword = credentials.slice(separator + 1);
  const usernameMatches = secretsEqual(username, PI_WEB_X_AUTH_USERNAME);
  const passwordMatches = secretsEqual(suppliedPassword, password);
  return usernameMatches && passwordMatches;
}

/**
 * 解析 Basic 授权头并校验用户名（不校验密码本身）。
 *
 * 供认证中间件使用：校验密码可走 scrypt（与 Web 认证同源）而非环境变量。
 *
 * @param authorization Authorization 头值；非法或缺省时返回 null
 * @returns 用户名匹配时的密码明文；用户名不匹配或格式非法返回 null
 */
export function parseBasicCredentials(
  authorization: string | null,
): string | null {
  if (!authorization) return null;
  const match = /^Basic\s+(\S+)$/i.exec(authorization);
  if (!match) return null;

  let credentials: string;
  try {
    const decoded = Buffer.from(match[1], "base64");
    if (decoded.toString("base64") !== match[1]) return null;
    credentials = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  } catch {
    return null;
  }

  const separator = credentials.indexOf(":");
  if (separator === -1) return null;

  const username = credentials.slice(0, separator);
  if (!secretsEqual(username, PI_WEB_X_AUTH_USERNAME)) return null;
  return credentials.slice(separator + 1);
}
