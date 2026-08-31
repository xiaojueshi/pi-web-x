import index from "./client/index.html";
import {
  findRoute,
  createHttpRequest,
  type RouteHandler,
} from "@/src/server/routes";
import { authorizeRequest } from "@/src/server/security";
import { servePublicAsset } from "@/src/server/public-assets";
import { drainSessionRefreshCookie } from "@/lib/pi-web-auth-route";

export interface ServerOptions {
  hostname: string;
  port: number;
}

/** 将已认证的静态资源请求转发给仅绑定 loopback 的 Bun HTML asset server。 */
async function fetchStaticAsset(
  request: Request,
  assetPort: number,
): Promise<Response> {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return new Response("Bad Request", { status: 400 });
  }
  url.hostname = "127.0.0.1";
  url.port = String(assetPort);
  return fetch(url, { method: request.method, headers: request.headers });
}

/**
 * 为 API 响应附加会话滑动续期的 Set-Cookie 头（如有）。
 * @param request 当前 HTTP 请求
 * @param response 原始 API 响应
 * @returns 附加续期头后的响应（未续期时原样返回）
 */
function withSessionRefresh(request: Request, response: Response): Response {
  const refresh = drainSessionRefreshCookie(request);
  if (!refresh) return response;
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", refresh);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** 启动 pi-web-x 的 Bun 原生 HTTP 服务。 */
export function startServer(
  options: ServerOptions,
): ReturnType<typeof Bun.serve> {
  const assetServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: {
      "/": index,
      // SPA 认证页面（/setup /login）由前端 AuthGate 按认证状态渲染；
      // 这里返回同一份 index.html，避免未初始化/未登录访问时 404。
      "/setup": index,
      "/login": index,
    },
  });

  if (assetServer.port === undefined)
    throw new Error("Static asset server did not receive a port");
  const assetPort = assetServer.port;

  try {
    return Bun.serve({
      hostname: options.hostname,
      port: options.port,
      fetch: async (request): Promise<Response> => {
        const denied = await authorizeRequest(request);
        if (denied) return denied;
        let url: URL;
        try {
          url = new URL(request.url);
        } catch {
          // 请求行中的 URL 非法时直接拒绝，避免解析异常破坏连接
          return new Response("Bad Request", { status: 400 });
        }
        if (!url.pathname.startsWith("/api/")) {
          const publicAsset =
            request.method === "GET" || request.method === "HEAD"
              ? await servePublicAsset(url.pathname)
              : null;
          return publicAsset ?? fetchStaticAsset(request, assetPort);
        }
        const route = findRoute(url.pathname);
        if (!route) return new Response("Not Found", { status: 404 });
        const handler = route.module[request.method];
        if (typeof handler !== "function") {
          const allowed = Object.keys(route.module).filter((key) =>
            /^[A-Z]+$/.test(key),
          );
          return new Response("Method Not Allowed", {
            status: 405,
            headers: { Allow: allowed.join(", ") },
          });
        }
        return withSessionRefresh(
          request,
          await (handler as RouteHandler)(createHttpRequest(request), {
            params: Promise.resolve(route.params),
          }),
        );
      },
    });
  } catch (error) {
    // 主服务绑定失败（如端口被占用）时回收静态资源服务，
    // 避免其保持事件循环活跃导致进程无法退出
    assetServer.stop(true);
    throw error;
  }
}
