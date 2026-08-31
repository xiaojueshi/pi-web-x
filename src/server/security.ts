import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isWebPasswordEnabled,
  parseBasicCredentials,
} from "@/lib/web-auth";
import { getAuthState, verifyPassword } from "@/lib/pi-web-auth";
import { getAuthenticatedSession } from "@/lib/pi-web-auth-route";

/** 公开放行的静态资源路径段（登录/设置页依赖的界面资产）。 */
const PUBLIC_ASSET_SEGMENTS = [
  "/manifest.webmanifest",
  "/sw.js",
  "/icons/",
  "/favicon.ico",
  "/apple-touch-icon",
];

/** 子资源扩展名：这些请求一律放行（脚本/样式/字体/图片等静态资产）。 */
const SUBRESOURCE_EXTENSIONS = [
  ".js",
  ".mjs",
  ".css",
  ".svg",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".map",
];

/**
 * 判断路径是否为前端子资源（Bun 编译产物为 /chunk-*.js 之类哈希名）。
 *
 * 登录/设置页依赖这些资产渲染认证表单，且它们不含受保护数据，
 * 因此必须跳过认证引导——否则 chunk 请求被 302 到 /setup 后
 * 返回 text/html，触发浏览器 MIME 类型检查报错导致白屏。
 */
function isSubresourcePath(pathname: string): boolean {
  if (
    PUBLIC_ASSET_SEGMENTS.some(
      (segment) => pathname === segment || pathname.startsWith(segment),
    )
  ) {
    return true;
  }
  const dot = pathname.lastIndexOf(".");
  if (dot === -1) return false;
  const ext = pathname.slice(dot).toLowerCase();
  return SUBRESOURCE_EXTENSIONS.includes(ext);
}

/** 是否属于 Web 访问认证自身的 API（这些端点在会话认证之外独立工作）。 */
function isWebAuthApi(pathname: string): boolean {
  return (
    pathname === "/api/auth/login" ||
    pathname === "/api/auth/logout" ||
    pathname === "/api/auth/password" ||
    pathname === "/api/auth/setup" ||
    pathname === "/api/auth/status"
  );
}

/**
 * 返回认证引导重定向：未初始化去 /setup，否则去 /login（带 redirect 回跳）。
 * @param request 当前 HTTP 请求
 * @param initialized 认证是否已初始化
 * @returns 302 重定向响应
 */
function redirectToAuth(request: Request, initialized: boolean): Response {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  const destination = initialized ? "/login" : "/setup";
  const authUrl = new URL(destination, url);
  if (initialized && url.pathname !== "/") {
    authUrl.searchParams.set("redirect", url.pathname + url.search);
  }
  return Response.redirect(authUrl, 302);
}

/** 解析请求 URL，非法时返回 null（调用方按 400 处理）。 */
function parseRequestUrl(request: Request): URL | null {
  try {
    return new URL(request.url);
  } catch {
    return null;
  }
}

/**
 * 判断是否为文档导航请求（浏览器地址栏/链接跳转）。
 *
 * 脚本/样式等子资源请求的 Accept 不包含 text/html，不能按页面处理——
 * 否则 /main.tsx 这类资源会被 302 到 /setup，导致 MIME 类型错误白屏。
 */
function isDocumentNavigation(request: Request): boolean {
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

/** 对所有 pi-web-x HTTP 请求应用 Host、来源、Web 访问认证与 Basic Auth 回退策略。
 * @param request 当前 HTTP 请求
 * @returns 拒绝/引导响应；null 表示放行
 */
export async function authorizeRequest(
  request: Request,
): Promise<Response | null> {
  const url = parseRequestUrl(request);
  if (!url) return new Response("Bad Request", { status: 400 });
  const pathname = url.pathname;
  const isApiRequest = pathname === "/api" || pathname.startsWith("/api/");
  // 仅文档导航（Accept: text/html）按页面处理并引导认证；
  // 脚本/样式等子资源放行（登录墙所需的前端资产，不含敏感数据）。
  const isHtmlRequest = isDocumentNavigation(request);

  // 1) Host / 来源校验（原有策略，不得绕过）
  const trusted = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);
  if (!trusted) {
    return isApiRequest
      ? Response.json({ error: "Untrusted API request" }, { status: 403 })
      : new Response("Untrusted request", { status: 403 });
  }

  // 2) Web 访问认证自身的 API 放行（登录/登出/改密/设置/状态在会话之外工作）
  if (isWebAuthApi(pathname)) return null;

  // 2.5) 非 API 的子资源（/chunk-*.js、/main.tsx、样式/字体等）：放行。
  // 登录/设置页需要加载自己的 JS/CSS 才能渲染认证表单；
  // 这些静态资产不含任何受保护数据（认证状态由 /api/auth/status 决定）。
  // 优先按扩展名判定，不依赖 Accept 头（浏览器对 module script 的
  // Accept 可能包含 text/html，单纯靠它判断会导致 chunk 被误重定向）。
  if (!isApiRequest && isSubresourcePath(pathname)) return null;

  // 3) 程序化回退：Basic Auth（CLI/curl/测试）
  //    - 已初始化：密码走 scrypt 校验（与 Web 认证同一密码源）
  //    - 未初始化但设置了 PI_WEB_X_PASSWORD：按环境变量校验（向后兼容）
  const authorization = request.headers.get("authorization");
  const envPassword = process.env.PI_WEB_X_PASSWORD;
  let basicAllowed = false;
  const basicPassword = parseBasicCredentials(authorization);
  if (basicPassword !== null) {
    try {
      const state = await getAuthState();
      if (state.initialized) {
        basicAllowed = await verifyPassword(basicPassword);
      } else if (
        isWebPasswordEnabled(envPassword) &&
        isValidBasicAuthorization(authorization, envPassword)
      ) {
        basicAllowed = true;
      }
    } catch {
      // 配置损坏时按未认证拒绝（下方 getAuthState 会再报 500）
    }
  }
  if (basicAllowed) return null;

  // 4) Web 访问认证（setup token + 会话 cookie）：认证数据已初始化时要求会话
  let initialized = false;
  try {
    initialized = (await getAuthState()).initialized;
  } catch {
    // 配置损坏：拒绝访问（内部错误），避免绕过认证
    return isApiRequest
      ? Response.json({ error: "Authentication unavailable" }, { status: 500 })
      : new Response("Authentication unavailable", { status: 500 });
  }

  // 未初始化（首次运行）：除认证 API 与公开资产外一律引导到 /setup；
  // /setup 页面自身放行（返回 HTML 供前端渲染设置表单）。
  if (!initialized) {
    if (pathname === "/setup") return null;
    if (isHtmlRequest) {
      return redirectToAuth(request, false);
    }
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }

  // 已初始化：校验会话 cookie
  const session = getAuthenticatedSession(request);
  if (session.valid) return null;

  // 会话无效：/login 页面自身放行（渲染登录表单），其余页面引导到 /login，API 返回 401
  if (pathname === "/login") return null;
  if (isHtmlRequest) {
    return redirectToAuth(request, true);
  }
  return Response.json({ error: "Authentication required" }, { status: 401 });
}
