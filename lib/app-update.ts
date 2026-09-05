const STABLE_VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;

/**
 * 发布物下载重定向 URL：`releases/latest/download/<file>` 会 302 到带 tag 的
 * 下载地址（`/releases/download/vX.Y.Z/SHA256SUMS`），从 Location 头即可提取
 * 最新稳定版本。走 github.com 静态下载域，不经过 api.github.com，无配额限制。
 */
export const REDIRECT_CHECK_URL =
	"https://github.com/xiaojueshi/pi-web-x/releases/latest/download/SHA256SUMS";

/** 更新检查 GitHub API 源：实时，但未认证限速 60 次/小时/IP，作为最后兑底。 */
export const DEFAULT_UPDATE_CHECK_URL =
	"https://api.github.com/repos/xiaojueshi/pi-web-x/releases/latest";

/** 更新检查 jsDelivr CDN 源（免配额，版本索引有几分钟到几小时的延迟）。 */
export const FALLBACK_UPDATE_CHECK_URL =
	"https://data.jsdelivr.com/v1/packages/gh/xiaojueshi/pi-web-x";

/** 单个更新检查源的描述（用于错误汇总与用户可感知的降级提示）。 */
interface UpdateCheckSource {
	/** 源 URL（显式镜像时可以是任意 JSON 源） */
	url: string;
	/** 源拉取方式：302 重定向解析或 JSON 响应体解析 */
	kind: "redirect" | "json";
	/** 用户可读的源名称 */
	label: string;
}

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
 /** 命中的更新源名称，用于用户可感知的降级提示 */
 source: string;
 /** 非空时表示发生过降级：排在命中源之前的各源失败原因摘要 */
 degradedFrom: string;
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
 * 从发布物下载重定向响应的 Location 头提取最新稳定版本号。
 *
 * Location 形如 `https://github.com/<owner>/<repo>/releases/download/vX.Y.Z/<file>`，
 * 提取其中的 tag 段并校验为稳定版本。
 *
 * @param location 302 响应的 Location 头值
 * @returns 最新稳定版本号（无 v 前缀）；无法解析出有效稳定版本时返回空字符串
 */
function parseLatestVersionFromRedirect(location: string): string {
	const match = /\/releases\/download\/(v[^/]+)\//.exec(location);
	if (!match) return "";
	const tag = match[1].replace(/^v/, "");
	return parseStableVersion(tag) ? tag : "";
}

/**
 * 从发布物下载重定向源（302）拉取最新稳定版本号。
 *
 * 使用 `redirect: "manual"` 只取第一跳：`releases/latest/download/<file>`
 * 先 302 到 `/releases/download/vX.Y.Z/<file>`（仍在 github.com），从该
 * Location 头解析版本号，不真正下载发布物。
 *
 * @param url 重定向源 URL
 * @param fetchFn 网络函数（测试注入）
 * @param timeoutMs 超时毫秒数
 * @returns 最新稳定版本号（无 v 前缀）
 * @throws 网络失败、非 302 响应或 Location 中无有效稳定版本时抛错
 */
async function fetchLatestVersionFromRedirect(
	url: string,
	fetchFn: typeof fetch,
	timeoutMs: number,
): Promise<string> {
	const response = await fetchFn(url, {
		redirect: "manual",
		cache: "no-store",
		headers: { "User-Agent": "pi-web-x" },
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (response.status !== 302 && response.status !== 301) {
		throw new Error(`redirect source returned HTTP ${response.status}`);
	}
	const location = response.headers.get("location") ?? "";
	if (!location) {
		throw new Error("redirect source returned no location header");
	}
	const latestVersion = parseLatestVersionFromRedirect(location);
	if (!latestVersion) {
		throw new Error(
			`redirect location has no valid stable version: ${location}`,
		);
	}
	return latestVersion;
}

/**
 * 从单个 JSON 更新源 URL 拉取并解析最新稳定版本号。
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
 * 未显式设置 PI_WEB_X_UPDATE_URL 时依次尝试三个源：
 * 1. GitHub 302 重定向解析（走 github.com 静态下载域，无 API、无配额）；
 * 2. jsDelivr CDN 列表（免配额，版本索引有几分钟到几小时的延迟）；
 * 3. GitHub API releases/latest（实时，但未认证限速 60 次/小时/IP，且配额按
 *    出口 IP 计，共享出口（VPS/VPN/CGNAT）下常被同 IP 请求耗尽，仅作兑底）。
 * 前面的源失败（如 403 限速、超时、网络不可达）时自动降级到下一个源；
 * 降级信息会随结果返回（degradedFrom），调用方应向用户提示版本信息来源。
 * 显式设置 PI_WEB_X_UPDATE_URL 时仅使用该源，保持镜像覆盖语义。
 *
 * @param env 环境变量（PI_WEB_X_UPDATE_URL 可覆盖源；默认 302 重定向 → jsDelivr → GitHub API）
 * @param fetchFn 网络函数（测试注入）
 * @param timeoutMs 单个源的超时毫秒数
 * @returns 最新版本号、release 页 URL、命中源名称与降级摘要；所有源均失败时抛错
 * @throws 所有更新源均不可达或无有效稳定版本时抛错（调用方降级处理）
 */
export async function fetchLatestVersionFromSource(
	env: NodeJS.ProcessEnv = process.env,
	fetchFn: typeof fetch = fetch,
	timeoutMs = 5_000,
): Promise<LatestVersionInfo> {
	const sources: UpdateCheckSource[] = env.PI_WEB_X_UPDATE_URL
		? [{
				url: env.PI_WEB_X_UPDATE_URL,
				kind: "json",
				label: "PI_WEB_X_UPDATE_URL 镜像",
			}]
		: [
				{ url: REDIRECT_CHECK_URL, kind: "redirect", label: "GitHub 302 重定向" },
				{ url: FALLBACK_UPDATE_CHECK_URL, kind: "json", label: "jsDelivr CDN" },
				{ url: DEFAULT_UPDATE_CHECK_URL, kind: "json", label: "GitHub API" },
			];

	const errors: string[] = [];
	for (const source of sources) {
		try {
			const latestVersion =
				source.kind === "redirect"
					? await fetchLatestVersionFromRedirect(
							source.url,
							fetchFn,
							timeoutMs,
						)
					: await fetchLatestVersionFromUrl(source.url, fetchFn, timeoutMs);
			const releaseUrl = getPiWebReleaseUrl(latestVersion);
			if (!releaseUrl) {
				errors.push(`${source.url}: response has no valid stable version`);
				continue;
			}
			return {
				latestVersion,
				releaseUrl,
				source: source.label,
				degradedFrom: errors.join("; "),
			};
		} catch (error) {
			errors.push(
				`${source.url}: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	throw new Error(`update source unavailable (${errors.join("; ")})`);
}
