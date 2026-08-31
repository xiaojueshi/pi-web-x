export type PwaConnectionKind = "loopback" | "lan" | "other";

export interface PwaConnectionStatus {
  kind: PwaConnectionKind;
  secure: boolean;
  pwaCapabilitiesAvailable: boolean;
}

/**
 * 判断主机名是否为浏览器本机回环地址。
 * @param hostname 不含端口的主机名
 * @returns 是否为回环地址
 */
export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized === "::1"
  );
}

/**
 * 判断 IPv4 地址是否属于私有或链路本地网络。
 * @param hostname 可能为 IPv4 地址的主机名
 * @returns 是否为私有或链路本地 IPv4 地址
 */
export function isPrivateIpv4Hostname(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 169 && octets[1] === 254)
  );
}

/**
 * 以可由浏览器可靠获得的信息归类当前访问地址。
 * @param hostname 不含端口的主机名
 * @returns 回环、私有局域网或无法进一步断言的其他地址类别
 */
export function getPwaConnectionKind(hostname: string): PwaConnectionKind {
  if (isLoopbackHostname(hostname)) return "loopback";
  return isPrivateIpv4Hostname(hostname) ? "lan" : "other";
}

/**
 * 计算 PWA 安装、Service Worker 和 Push 所需的浏览器安全上下文状态。
 * @param url 当前页面 URL
 * @param isSecureContextValue 浏览器的安全上下文标识
 * @returns 仅基于当前浏览器可验证事实得出的连接状态
 */
export function getPwaConnectionStatus(
  url: URL,
  isSecureContextValue: boolean,
): PwaConnectionStatus {
  const kind = getPwaConnectionKind(url.hostname);
  return {
    kind,
    secure: isSecureContextValue,
    pwaCapabilitiesAvailable: isSecureContextValue,
  };
}
