import assert from "node:assert/strict";
import { test } from "bun:test";

const {
  getPiWebReleaseUrl,
  isNewerStableVersion,
  fetchLatestVersionFromSource,
  REDIRECT_CHECK_URL,
  DEFAULT_UPDATE_CHECK_URL,
  FALLBACK_UPDATE_CHECK_URL,
} = await import("../../../lib/app-update.ts");

/** 302 重定向响应（Location 指向带 tag 的发布物下载地址）。 */
function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location },
  });
}

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

test("parses the latest version from the 302 redirect source (primary)", async () => {
  const routes = new Map<string, Response>();
  routes.set(
    REDIRECT_CHECK_URL,
    redirectResponse(
      "https://github.com/xiaojueshi/pi-web-x/releases/download/v0.10.0/SHA256SUMS",
    ),
  );
  const result = await fetchLatestVersionFromSource(
    {},
    routeFetch(routes),
    1_000,
  );
  assert.equal(result.latestVersion, "0.10.0");
  assert.equal(
    result.releaseUrl,
    "https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.10.0",
  );
  assert.equal(result.source, "GitHub 302 重定向");
  // 主源命中时不产生降级提示
  assert.equal(result.degradedFrom, "");
});

// 未注册其它源的路由：routeFetch 对未注册 URL 返回 404，验证主源优先、
// jsDelivr 与 GitHub API 不被请求

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
  // 前两个源（302/jsDelivr）均未注册而 404，GitHub API 作为兑底命中
  assert.equal(result.source, "GitHub API");
  assert.match(result.degradedFrom, /redirect source returned HTTP 404/);
});

test("falls back to jsDelivr when the redirect source fails", async () => {
  const routes = new Map<string, Response>();
  routes.set(REDIRECT_CHECK_URL, new Response("forbidden", { status: 403 }));
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
  assert.equal(result.source, "jsDelivr CDN");
  // 降级摘要只包含命中源之前的失败原因；jsDelivr 命中后 GitHub API 不再被请求
  assert.match(result.degradedFrom, /redirect source returned HTTP 403/);
  assert.doesNotMatch(result.degradedFrom, /api\.github\.com/);
});

test("falls back to jsDelivr when earlier sources fail, GitHub API not reached", async () => {
  const routes = new Map<string, Response>();
  // 主源 302 与 GitHub API 均未注册（404），jsDelivr 正常响应
  routes.set(
    FALLBACK_UPDATE_CHECK_URL,
    jsonResponse(200, { tag_name: "v0.9.1" }),
  );
  const result = await fetchLatestVersionFromSource(
    {},
    routeFetch(routes),
    1_000,
  );
  assert.equal(result.latestVersion, "0.9.1");
  assert.equal(result.source, "jsDelivr CDN");
  assert.match(result.degradedFrom, /redirect source returned HTTP 404/);
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
  assert.equal(result.source, "PI_WEB_X_UPDATE_URL 镜像");
  assert.equal(result.degradedFrom, "");
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
    REDIRECT_CHECK_URL,
    redirectResponse(
      "https://github.com/xiaojueshi/pi-web-x/releases/download/v0.9.2-beta.1/SHA256SUMS",
    ),
  );
  routes.set(
    DEFAULT_UPDATE_CHECK_URL,
    jsonResponse(200, { tag_name: "v0.9.2-beta.1" }),
  );
  await assert.rejects(
    fetchLatestVersionFromSource({}, routeFetch(routes), 1_000),
    /update source unavailable/,
  );
});

test("rejects a redirect location without a releases/download path", async () => {
  const routes = new Map<string, Response>();
  routes.set(
    REDIRECT_CHECK_URL,
    redirectResponse("https://github.com/xiaojueshi/pi-web-x/releases/tag/v0.9.2"),
  );
  await assert.rejects(
    fetchLatestVersionFromSource({}, routeFetch(routes), 1_000),
    /update source unavailable/,
  );
});
