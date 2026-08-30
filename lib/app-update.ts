const STABLE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** 更新检查源：默认 GitHub API，可用 PI_WEB_X_UPDATE_URL 指向内网镜像。 */
export const DEFAULT_UPDATE_CHECK_URL =
  "https://api.github.com/repos/xiaojueshi/pi-web-x/releases/latest";

function parseStableVersion(version: string): [number, number, number] | null {
  const match = STABLE_VERSION_PATTERN.exec(version);
  if (!match) return null;

  const parts = match.slice(1).map(Number);
  if (parts.some((part) => !Number.isSafeInteger(part))) return null;
  return parts as [number, number, number];
}

export function isNewerStableVersion(
  candidate: string,
  current: string,
): boolean {
  const candidateParts = parseStableVersion(candidate);
  const currentParts = parseStableVersion(current);
  if (!candidateParts || !currentParts) return false;

  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index];
    }
  }
  return false;
}

export function getPiWebReleaseUrl(version: string): string | null {
  if (!parseStableVersion(version)) return null;
  return `https://github.com/xiaojueshi/pi-web-x/releases/tag/v${version}`;
}

/** 更新检查结果（与 app/api/app-update/route.ts 共享）。 */
export interface LatestVersionInfo {
  latestVersion: string;
  releaseUrl: string;
}

/**
 * 从更新源拉取最新稳定版本（无缓存；调用方自行决定缓存策略）。
 *
 * @param env 环境变量（PI_WEB_X_UPDATE_URL 可覆盖源；默认 GitHub API）
 * @param fetchFn 网络函数（测试注入）
 * @param timeoutMs 超时毫秒数
 * @returns 最新版本号与 release 页 URL；失败抛错（调用方降级处理）
 */
export async function fetchLatestVersionFromSource(
  env: NodeJS.ProcessEnv = process.env,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 5_000,
): Promise<LatestVersionInfo> {
  const url = env.PI_WEB_X_UPDATE_URL ?? DEFAULT_UPDATE_CHECK_URL;
  const response = await fetchFn(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "pi-web-x" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`update source returned HTTP ${response.status}`);
  }
  const body = (await response.json()) as { tag_name?: unknown };
  const latestVersion =
    typeof body.tag_name === "string" && body.tag_name
      ? body.tag_name.replace(/^v/, "")
      : "";
  const releaseUrl = getPiWebReleaseUrl(latestVersion);
  if (!releaseUrl) throw new Error("update source returned an invalid version");
  return { latestVersion, releaseUrl };
}
