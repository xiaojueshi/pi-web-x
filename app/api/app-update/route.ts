import { HttpResponse } from "@/src/server/http";
import type { AppUpdateResponse } from "@/lib/api-types";
import {
  fetchLatestVersionFromSource,
  getPiWebReleaseUrl,
  isNewerStableVersion,
} from "@/lib/app-update";
import { APP_VERSION } from "@/src/version";

export const dynamic = "force-dynamic";

const CURRENT_VERSION = APP_VERSION;
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
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
  // 源不可达时由调用方降级为“无更新”，这里抛出以命中公共缓存逻辑。
  const { latestVersion } = await fetchLatestVersionFromSource();
  return {
    currentVersion: CURRENT_VERSION,
    latestVersion,
    updateAvailable: isNewerStableVersion(latestVersion, CURRENT_VERSION),
    releaseUrl: getPiWebReleaseUrl(latestVersion) ?? "",
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
