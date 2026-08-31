const STABLE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/** 更新检查主源：GitHub API（实时，但未认证限速 60 次/小时）。 */
export const DEFAULT_UPDATE_CHECK_URL =
 "https://api.github.com/repos/xiaojueshi/pi-web-x/releases/latest";

/** 更新检查备源：jsDelivr CDN（无 API 限速），主源失败时自动降级。 */
export const FALLBACK_UPDATE_CHECK_URL =
 "https://data.jsdelivr.com/v1/packages/gh/xiaojueshi/pi-web-x";

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
 * 从更新源响应体解析最新稳定版本号（兼容 GitHub API 与 jsDelivr 两种镜像格式）。
 *
 * - GitHub API / 常见镜像：`{ "tag_name": "v0.9.2" }`
 * - jsDelivr CDN：`{ "versions": [{ "version": "0.9.2" }, ...] }`，取其中最大的稳定版本
 *
 * @param body 解析后的 JSON 响应体
 * @returns 最新稳定版本号（无 v 前缀）；无法解析出有效稳定版本时返回空字符串
 */
function parseLatestVersionFromBody(body: unknown): string {
 if (!body || typeof body !== "object") return "";
 const record = body as Record<string, unknown>;

 // GitHub API 格式：tag_name 形如 "v0.9.2"
 const tagName = record.tag_name;
 if (typeof tagName === "string" && tagName) {
  const tag = tagName.replace(/^v/, "");
  if (parseStableVersion(tag)) return tag;
 }

 // jsDelivr 格式：versions 数组，顺序不保证，取最大的稳定版本
 const versions = record.versions;
 if (Array.isArray(versions)) {
  let best = "0.0.0";
  for (const entry of versions) {
   const version =
    entry &&
    typeof entry === "object" &&
    typeof (entry as { version?: unknown }).version === "string"
     ? (entry as { version: string }).version.replace(/^v/, "")
     : "";
   if (version && isNewerStableVersion(version, best)) best = version;
  }
  return best === "0.0.0" ? "" : best;
 }

 return "";
}

/**
 * 从单个更新源 URL 拉取并解析最新稳定版本号。
 *
 * @param url 更新源 URL
 * @param fetchFn 网络函数（测试注入）
 * @param timeoutMs 超时毫秒数
 * @returns 最新稳定版本号（无 v 前缀）
 * @throws 网络失败、非 2xx 响应或响应中无有效稳定版本时抛错
 */
async function fetchLatestVersionFromUrl(
 url: string,
 fetchFn: typeof fetch,
 timeoutMs: number,
): Promise<string> {
 const response = await fetchFn(url, {
  cache: "no-store",
  headers: { Accept: "application/json", "User-Agent": "pi-web-x" },
  signal: AbortSignal.timeout(timeoutMs),
 });
 if (!response.ok) {
  throw new Error(`update source returned HTTP ${response.status}`);
 }
 const latestVersion = parseLatestVersionFromBody(await response.json());
 if (!latestVersion) {
  throw new Error("update source returned an invalid version");
 }
 return latestVersion;
}

/**
 * 从更新源拉取最新稳定版本（无缓存；调用方自行决定缓存策略）。
 *
 * 未显式设置 PI_WEB_X_UPDATE_URL 时依次尝试 GitHub API（实时）与 jsDelivr
 * CDN（免限速）两个源：主源返回 403（共享出口 IP 的 API 配额耗尽）、超时或
 * 网络不可达时自动降级到备源，避免更新检查因 GitHub API 限速而失败。
 * 显式设置 PI_WEB_X_UPDATE_URL 时仅使用该源，保持镜像覆盖语义。
 *
 * @param env 环境变量（PI_WEB_X_UPDATE_URL 可覆盖源；默认 GitHub API + jsDelivr 降级）
 * @param fetchFn 网络函数（测试注入）
 * @param timeoutMs 单个源的超时毫秒数
 * @returns 最新版本号与 release 页 URL；所有源均失败时抛错（调用方降级处理）
 */
export async function fetchLatestVersionFromSource(
 env: NodeJS.ProcessEnv = process.env,
 fetchFn: typeof fetch = fetch,
 timeoutMs = 5_000,
): Promise<LatestVersionInfo> {
 const sources = env.PI_WEB_X_UPDATE_URL
  ? [env.PI_WEB_X_UPDATE_URL]
  : [DEFAULT_UPDATE_CHECK_URL, FALLBACK_UPDATE_CHECK_URL];

 const errors: string[] = [];
 for (const url of sources) {
  try {
   const latestVersion = await fetchLatestVersionFromUrl(
    url,
    fetchFn,
    timeoutMs,
   );
   const releaseUrl = getPiWebReleaseUrl(latestVersion);
   if (!releaseUrl) {
    errors.push(`${url}: response has no valid stable version`);
    continue;
   }
   return { latestVersion, releaseUrl };
  } catch (error) {
   errors.push(
    `${url}: ${error instanceof Error ? error.message : String(error)}`,
   );
  }
 }
 throw new Error(`update source unavailable (${errors.join("; ")})`);
}
