import { HttpResponse } from "@/src/server/http";
import type { AppUpdateResponse } from "@/lib/api-types";
import { getPiWebReleaseUrl, isNewerStableVersion } from "@/lib/app-update";
import { APP_VERSION } from "@/src/version";

export const dynamic = "force-dynamic";

const CURRENT_VERSION = APP_VERSION;
// 发布会通过 GitHub Releases（releases/tag/vX.Y.Z）；允许用环境变量覆盖检查源。
const UPDATE_CHECK_URL =
  process.env.PI_WEB_X_UPDATE_URL ??
  "https://api.github.com/repos/xiaojueshi/pi-web-x/releases/latest";
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5_000;
const SKIP_VERSION_CHECK = process.env.PI_WEB_X_SKIP_VERSION_CHECK === "1";

interface AppUpdateCache {
  value?: AppUpdateResponse;
  expiresAt: number;
  inFlight?: Promise<AppUpdateResponse>;
}

declare global {
  var __piWebAppUpdateCache: AppUpdateCache | undefined;
}

function getCache(): AppUpdateCache {
  return (globalThis.__piWebAppUpdateCache ??= { expiresAt: 0 });
}

async function fetchLatestVersion(): Promise<AppUpdateResponse> {
  const response = await fetch(UPDATE_CHECK_URL, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": "pi-web-x" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`update source returned HTTP ${response.status}`);

  const body = (await response.json()) as { tag_name?: unknown };
  const latestVersion =
    typeof body.tag_name === "string" && body.tag_name
      ? body.tag_name.replace(/^v/, "")
      : "";
  const releaseUrl = getPiWebReleaseUrl(latestVersion);
  if (!releaseUrl) throw new Error("update source returned an invalid version");

  return {
    currentVersion: CURRENT_VERSION,
    latestVersion,
    updateAvailable: isNewerStableVersion(latestVersion, CURRENT_VERSION),
    releaseUrl,
  };
}

async function loadUpdateStatus(): Promise<AppUpdateResponse> {
  const cache = getCache();
  if (cache.value && cache.expiresAt > Date.now()) return cache.value;
  if (!cache.inFlight) {
    cache.inFlight = fetchLatestVersion()
      .then((value) => {
        cache.value = value;
        cache.expiresAt = Date.now() + CACHE_TTL_MS;
        return value;
      })
      .finally(() => {
        cache.inFlight = undefined;
      });
  }

  try {
    return await cache.inFlight;
  } catch (error) {
    if (cache.value) return cache.value;
    throw error;
  }
}

export async function GET() {
  if (SKIP_VERSION_CHECK) {
    return HttpResponse.json({
      currentVersion: CURRENT_VERSION,
      latestVersion: CURRENT_VERSION,
      updateAvailable: false,
      releaseUrl: "",
    } satisfies AppUpdateResponse);
  }
  try {
    return HttpResponse.json(await loadUpdateStatus());
  } catch {
    // 更新源不可达或尚未发布时按“无更新”降级，避免每次轮询产生 502 噪音。
    return HttpResponse.json({
      currentVersion: CURRENT_VERSION,
      latestVersion: CURRENT_VERSION,
      updateAvailable: false,
      releaseUrl: "",
    } satisfies AppUpdateResponse);
  }
}
