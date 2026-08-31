import assert from "node:assert/strict";
import { test } from "bun:test";

const {
  getPiWebReleaseUrl,
  isNewerStableVersion,
  fetchLatestVersionFromSource,
  DEFAULT_UPDATE_CHECK_URL,
  FALLBACK_UPDATE_CHECK_URL,
} = await import("../../../lib/app-update.ts");

/** 按 URL 分发响应的假 fetch（测试注入）。 */
function routeFetch(routes: Map<string, Response>): typeof fetch {
  return async (input: RequestInfo | URL) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const route = routes.get(url);
    if (!route) return new Response("not found", { status: 404 });
    return route;
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("detects newer stable Pi Web X versions", () => {
  assert.equal(isNewerStableVersion("0.8.8", "0.8.7"), true);
  assert.equal(isNewerStableVersion("0.9.0", "0.8.7"), true);
  assert.equal(isNewerStableVersion("1.0.0", "0.9.9"), true);
});

test("does not report equal, older, or unsupported versions as updates", () => {
  assert.equal(isNewerStableVersion("0.8.7", "0.8.7"), false);
  assert.equal(isNewerStableVersion("0.8.6", "0.8.7"), false);
  assert.equal(isNewerStableVersion("0.8.8-beta.1", "0.8.7"), false);
  assert.equal(isNewerStableVersion("invalid", "0.8.7"), false);
});

test("builds a release-notes URL only for stable versions", () => {
  assert.equal(
    getPiWebReleaseUrl("0.8.8"),
    "https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.8.8",
  );
  assert.equal(getPiWebReleaseUrl("0.8.8-beta.1"), null);
});

test("fetches the latest version from the GitHub API format", async () => {
  const routes = new Map<string, Response>();
  routes.set(
    DEFAULT_UPDATE_CHECK_URL,
    jsonResponse(200, { tag_name: "v0.9.2" }),
  );
  const result = await fetchLatestVersionFromSource(
    {},
    routeFetch(routes),
    1_000,
  );
  assert.equal(result.latestVersion, "0.9.2");
  assert.equal(
    result.releaseUrl,
    "https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.9.2",
  );
});

test("falls back to jsDelivr when the GitHub API returns HTTP 403", async () => {
  const routes = new Map<string, Response>();
  routes.set(
    DEFAULT_UPDATE_CHECK_URL,
    jsonResponse(403, { message: "API rate limit exceeded" }),
  );
  // jsDelivr 版本顺序不保证：乱序时应取最大的稳定版本
  routes.set(
    FALLBACK_UPDATE_CHECK_URL,
    jsonResponse(200, {
      versions: [
        { version: "0.8.12" },
        { version: "0.9.2" },
        { version: "0.9.1" },
      ],
    }),
  );
  const result = await fetchLatestVersionFromSource(
    {},
    routeFetch(routes),
    1_000,
  );
  assert.equal(result.latestVersion, "0.9.2");
});

test("falls back to jsDelivr when the GitHub API times out", async () => {
  const routes = new Map<string, Response>();
  routes.set(
    FALLBACK_UPDATE_CHECK_URL,
    jsonResponse(200, { tag_name: "v0.9.1" }),
  );
  const fetchFn: typeof fetch = async (input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    if (url === DEFAULT_UPDATE_CHECK_URL)
      throw new Error("network unreachable");
    return routes.get(url) ?? new Response("not found", { status: 404 });
  };
  const result = await fetchLatestVersionFromSource({}, fetchFn, 1_000);
  assert.equal(result.latestVersion, "0.9.1");
});

test("uses only the explicit PI_WEB_X_UPDATE_URL mirror when set", async () => {
  const mirror = "https://example.com/pi-web-x/latest.json";
  const routes = new Map<string, Response>();
  routes.set(mirror, jsonResponse(200, { tag_name: "v0.9.2" }));
  // 显式镜像设置后，即使默认源可用也不应被请求（路由表里未注册默认源即验证）
  const result = await fetchLatestVersionFromSource(
    { PI_WEB_X_UPDATE_URL: mirror },
    routeFetch(routes),
    1_000,
  );
  assert.equal(result.latestVersion, "0.9.2");
});

test("throws when every update source fails", async () => {
  const routes = new Map<string, Response>();
  routes.set(
    DEFAULT_UPDATE_CHECK_URL,
    jsonResponse(403, { message: "API rate limit exceeded" }),
  );
  routes.set(FALLBACK_UPDATE_CHECK_URL, jsonResponse(500, {}));
  await assert.rejects(
    fetchLatestVersionFromSource({}, routeFetch(routes), 1_000),
    /update source unavailable/,
  );
});

test("rejects sources that report a non-stable version as latest", async () => {
  const routes = new Map<string, Response>();
  routes.set(
    DEFAULT_UPDATE_CHECK_URL,
    jsonResponse(200, { tag_name: "v0.9.2-beta.1" }),
  );
  await assert.rejects(
    fetchLatestVersionFromSource({}, routeFetch(routes), 1_000),
    /update source unavailable/,
  );
});
