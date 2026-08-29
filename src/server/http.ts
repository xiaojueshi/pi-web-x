/** Bun 环境中供遗留 route 模块使用的最小 HTTP 兼容层。 */
export type HttpRequest = Request & { readonly nextUrl: URL };

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
