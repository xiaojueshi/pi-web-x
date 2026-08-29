import type { HttpRequest } from "@/src/server/http";

type RouteParams = Record<string, string | string[]>;
export type RouteHandler = (
  request: Request,
  context: { params: Promise<RouteParams> },
) => Response | Promise<Response>;
type RouteModule = Record<string, unknown>;

/** Bun 路由表中的遗留 API 模块。所有导入均为静态导入，以便编译二进制收集依赖。 */
import * as route0 from "../../app/api/agent/[id]/bash-output/route.ts";
import * as route1 from "../../app/api/agent/[id]/events/route.ts";
import * as route2 from "../../app/api/agent/[id]/route.ts";
import * as route3 from "../../app/api/agent/new/route.ts";
import * as route4 from "../../app/api/agent/running/route.ts";
import * as route5 from "../../app/api/app-update/route.ts";
import * as route6 from "../../app/api/auth/api-key/[provider]/route.ts";
import * as route7 from "../../app/api/auth/login/[provider]/route.ts";
import * as route8 from "../../app/api/auth/logout/[provider]/route.ts";
import * as route9 from "../../app/api/auth/providers/route.ts";
import * as route10 from "../../app/api/cwd/browse/route.ts";
import * as route11 from "../../app/api/cwd/validate/route.ts";
import * as route12 from "../../app/api/default-cwd/route.ts";
import * as route13 from "../../app/api/file-index/route.ts";
import * as route14 from "../../app/api/files/[...path]/route.ts";
import * as route15 from "../../app/api/git/diff/route.ts";
import * as route16 from "../../app/api/git/status/route.ts";
import * as route17 from "../../app/api/home/route.ts";
import * as route18 from "../../app/api/models/route.ts";
import * as route19 from "../../app/api/models-config/catalog/route.ts";
import * as route20 from "../../app/api/models-config/discover/route.ts";
import * as route21 from "../../app/api/models-config/route.ts";
import * as route22 from "../../app/api/models-config/test/route.ts";
import * as route23 from "../../app/api/plugins/route.ts";
import * as route24 from "../../app/api/project-trust/route.ts";
import * as route25 from "../../app/api/push/config/route.ts";
import * as route26 from "../../app/api/push/subscribe/route.ts";
import * as route27 from "../../app/api/sessions/[id]/auto-name/route.ts";
import * as route28 from "../../app/api/sessions/[id]/context/route.ts";
import * as route29 from "../../app/api/sessions/[id]/entries/[entryId]/thinking/route.ts";
import * as route30 from "../../app/api/sessions/[id]/entries/[entryId]/tool-result-image/route.ts";
import * as route31 from "../../app/api/sessions/[id]/export/route.ts";
import * as route32 from "../../app/api/sessions/[id]/route.ts";
import * as route33 from "../../app/api/sessions/[id]/state/route.ts";
import * as route34 from "../../app/api/sessions/route.ts";
import * as route35 from "../../app/api/skills/check/route.ts";
import * as route36 from "../../app/api/skills/install/route.ts";
import * as route37 from "../../app/api/skills/route.ts";
import * as route38 from "../../app/api/skills/search/route.ts";
import * as route39 from "../../app/api/skills/update/route.ts";
import * as route40 from "../../app/api/subagents/[id]/route.ts";
import * as route41 from "../../app/api/subagents/profiles/route.ts";
import * as route42 from "../../app/api/subagents/settings/route.ts";
import * as route43 from "../../app/api/tools/settings/route.ts";
import * as route44 from "../../app/api/worktrees/route.ts";

const ROUTES: Array<{ pattern: string; module: RouteModule }> = [
  { pattern: "/api/agent/[id]/bash-output", module: route0 as RouteModule },
  { pattern: "/api/agent/[id]/events", module: route1 as RouteModule },
  { pattern: "/api/agent/[id]", module: route2 as RouteModule },
  { pattern: "/api/agent/new", module: route3 as RouteModule },
  { pattern: "/api/agent/running", module: route4 as RouteModule },
  { pattern: "/api/app-update", module: route5 as RouteModule },
  { pattern: "/api/auth/api-key/[provider]", module: route6 as RouteModule },
  { pattern: "/api/auth/login/[provider]", module: route7 as RouteModule },
  { pattern: "/api/auth/logout/[provider]", module: route8 as RouteModule },
  { pattern: "/api/auth/providers", module: route9 as RouteModule },
  { pattern: "/api/cwd/browse", module: route10 as RouteModule },
  { pattern: "/api/cwd/validate", module: route11 as RouteModule },
  { pattern: "/api/default-cwd", module: route12 as RouteModule },
  { pattern: "/api/file-index", module: route13 as RouteModule },
  { pattern: "/api/files/[...path]", module: route14 as RouteModule },
  { pattern: "/api/git/diff", module: route15 as RouteModule },
  { pattern: "/api/git/status", module: route16 as RouteModule },
  { pattern: "/api/home", module: route17 as RouteModule },
  { pattern: "/api/models", module: route18 as RouteModule },
  { pattern: "/api/models-config/catalog", module: route19 as RouteModule },
  { pattern: "/api/models-config/discover", module: route20 as RouteModule },
  { pattern: "/api/models-config", module: route21 as RouteModule },
  { pattern: "/api/models-config/test", module: route22 as RouteModule },
  { pattern: "/api/plugins", module: route23 as RouteModule },
  { pattern: "/api/project-trust", module: route24 as RouteModule },
  { pattern: "/api/push/config", module: route25 as RouteModule },
  { pattern: "/api/push/subscribe", module: route26 as RouteModule },
  { pattern: "/api/sessions/[id]/auto-name", module: route27 as RouteModule },
  { pattern: "/api/sessions/[id]/context", module: route28 as RouteModule },
  {
    pattern: "/api/sessions/[id]/entries/[entryId]/thinking",
    module: route29 as RouteModule,
  },
  {
    pattern: "/api/sessions/[id]/entries/[entryId]/tool-result-image",
    module: route30 as RouteModule,
  },
  { pattern: "/api/sessions/[id]/export", module: route31 as RouteModule },
  { pattern: "/api/sessions/[id]", module: route32 as RouteModule },
  { pattern: "/api/sessions/[id]/state", module: route33 as RouteModule },
  { pattern: "/api/sessions", module: route34 as RouteModule },
  { pattern: "/api/skills/check", module: route35 as RouteModule },
  { pattern: "/api/skills/install", module: route36 as RouteModule },
  { pattern: "/api/skills", module: route37 as RouteModule },
  { pattern: "/api/skills/search", module: route38 as RouteModule },
  { pattern: "/api/skills/update", module: route39 as RouteModule },
  { pattern: "/api/subagents/[id]", module: route40 as RouteModule },
  { pattern: "/api/subagents/profiles", module: route41 as RouteModule },
  { pattern: "/api/subagents/settings", module: route42 as RouteModule },
  { pattern: "/api/tools/settings", module: route43 as RouteModule },
  { pattern: "/api/worktrees", module: route44 as RouteModule },
];

/** 将 Bun Request 包装为遗留 route 所需的 HttpRequest 最小形态。 */
export function createHttpRequest(request: Request): HttpRequest {
  const nextUrl = new URL(request.url);
  return new Proxy(request, {
    get(target, property) {
      if (property === "nextUrl") return nextUrl;
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as HttpRequest;
}

/** 按文件系统风格路由模式匹配路径，并提取动态参数。 */
function match(pattern: string, pathname: string): RouteParams | null {
  const parts = pathname.split("/").filter(Boolean);
  const patternParts = pattern.split("/").filter(Boolean);
  const params: RouteParams = {};
  let index = 0;
  for (const segment of patternParts) {
    const catchAll = /^\[\.\.\.(.+)\]$/.exec(segment);
    if (catchAll) {
      params[catchAll[1]] = parts.slice(index).map(decodeURIComponent);
      return index <= parts.length ? params : null;
    }
    const dynamic = /^\[(.+)\]$/.exec(segment);
    const actual = parts[index++];
    if (actual === undefined) return null;
    if (dynamic) {
      params[dynamic[1]] = decodeURIComponent(actual);
      continue;
    }
    if (segment !== actual) return null;
  }
  return index === parts.length ? params : null;
}

/** 为请求查找对应 API module 和动态参数。 */
export function findRoute(
  pathname: string,
): { module: RouteModule; params: RouteParams } | null {
  for (const route of ROUTES) {
    const params = match(route.pattern, pathname);
    if (params) return { module: route.module, params };
  }
  return null;
}
