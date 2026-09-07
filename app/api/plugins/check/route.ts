// POST /api/plugins/check：对已配置插件执行只读的远端更新检查。
// 支持全量检查（仅传 cwd）与单个插件检查（source + scope 必须成对提供）。
import { HttpResponse } from "@/src/server/http";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
} from "@/lib/file-access";
import {
  hasJsonContentType,
  isApiRequestAllowed,
} from "@/lib/request-security";
import { checkPluginUpdates } from "@/lib/plugin-updates";
import type { PluginScope } from "@/lib/api-types";

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return HttpResponse.json(
      { error: "Untrusted API request" },
      { status: 403 },
    );
  }
  if (!hasJsonContentType(req)) {
    return HttpResponse.json(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }

  try {
    const body = (await req.json()) as {
      cwd?: unknown;
      source?: unknown;
      scope?: unknown;
    };
    const cwd = typeof body.cwd === "string" ? body.cwd : "";
    if (!cwd)
      return HttpResponse.json({ error: "cwd required" }, { status: 400 });
    const allowedRoots = await getAllowedFileRoots();
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return HttpResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const source = typeof body.source === "string" ? body.source : undefined;
    const scope =
      body.scope === "global" || body.scope === "project"
        ? (body.scope as PluginScope)
        : undefined;
    if ((source && !scope) || (!source && scope)) {
      return HttpResponse.json(
        { error: "source and scope must be provided together" },
        { status: 400 },
      );
    }

    const updates = await checkPluginUpdates(
      cwd,
      source && scope ? { source, scope } : undefined,
    );
    if (source && scope && updates.length === 0) {
      return HttpResponse.json(
        { error: "Configured package not found" },
        { status: 404 },
      );
    }

    return HttpResponse.json({ updates });
  } catch (error) {
    return HttpResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
