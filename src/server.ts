import index from "./client/index.html";
import {
  findRoute,
  createHttpRequest,
  type RouteHandler,
} from "@/src/server/routes";
import { authorizeRequest } from "@/src/server/security";
import { servePublicAsset } from "@/src/server/public-assets";

export interface ServerOptions {
  hostname: string;
  port: number;
}

/** 将已认证的静态资源请求转发给仅绑定 loopback 的 Bun HTML asset server。 */
async function fetchStaticAsset(
  request: Request,
  assetPort: number,
): Promise<Response> {
  const url = new URL(request.url);
  url.hostname = "127.0.0.1";
  url.port = String(assetPort);
  return fetch(url, { method: request.method, headers: request.headers });
}

/** 启动 pi-web-x 的 Bun 原生 HTTP 服务。 */
export function startServer(
  options: ServerOptions,
): ReturnType<typeof Bun.serve> {
  const assetServer = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    routes: { "/": index },
  });

  if (assetServer.port === undefined)
    throw new Error("Static asset server did not receive a port");
  const assetPort = assetServer.port;

  return Bun.serve({
    hostname: options.hostname,
    port: options.port,
    fetch: async (request): Promise<Response> => {
      const denied = authorizeRequest(request);
      if (denied) return denied;
      const url = new URL(request.url);
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
      return (handler as RouteHandler)(createHttpRequest(request), {
        params: Promise.resolve(route.params),
      });
    },
  });
}
