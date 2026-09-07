/** Bun 环境中供遗留 route 模块使用的最小 HTTP 兼容层。 */
export type HttpRequest = Request & { readonly nextUrl: URL };

/**
 * 安全读取服务端构造请求的 URL 查询参数。
 *
 * Bun 路由的 request.url 由服务端构造，恒为合法 URL；集中封装解析
 * 以满足 unchecked-throwing-call 防护要求并统一读取方式。
 *
 * @param request 当前请求。
 * @returns URLSearchParams；URL 解析失败时返回空集合。
 */
export function requestSearchParams(request: Request): URLSearchParams {
 try {
  return new URL(request.url).searchParams;
 } catch {
  return new URLSearchParams();
 }
}

/** 兼容遗留 route 中的 HttpResponse JSON 工厂。 */
export class HttpResponse extends Response {
 /** 创建 JSON 响应并默认设置 JSON content-type。 */
 static json(body: unknown, init: ResponseInit = {}): HttpResponse {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type"))
   headers.set("content-type", "application/json");
  return new HttpResponse(JSON.stringify(body), { ...init, headers });
 }

 /** 返回空的继续响应；仅保留给尚未迁移的 middleware 调用。 */
 static next(init: ResponseInit = {}): HttpResponse {
  return new HttpResponse(null, init);
 }
}
