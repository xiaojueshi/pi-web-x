import { HttpResponse, requestSearchParams } from "@/src/server/http";
import { existsSync } from "fs";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
} from "@/lib/file-access";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getProjectTrustStatus, trustProject } from "@/lib/project-trust";
import {
  deleteSubagentProfile,
  listSubagentProfileSources,
  saveSubagentProfile,
  type SubagentProfile,
  type SubagentWritableScope,
} from "@/lib/subagents";

async function validateCwd(cwd: unknown): Promise<string> {
  if (typeof cwd !== "string" || !cwd || !existsSync(cwd))
    throw new Error("Valid cwd required");
  if (!isExistingFilePathAllowed(cwd, await getAllowedFileRoots()))
    throw new Error("Access denied");
  return cwd;
}

function validateScope(scope: unknown): SubagentWritableScope {
  if (scope !== "global" && scope !== "project")
    throw new Error("scope must be global or project");
  return scope;
}

async function validateCwdForScope(
  cwd: unknown,
  scope: SubagentWritableScope,
): Promise<string> {
  // 全局 profile 不依赖项目，也必须能在未打开项目时维护。
  if (scope === "global" && (cwd === undefined || cwd === null || cwd === ""))
    return getAgentDir();
  return validateCwd(cwd);
}

function assertWritableScopeTrusted(
  cwd: string,
  scope: SubagentWritableScope,
): void {
  if (scope !== "project") return;
  if (!getProjectTrustStatus(cwd, getAgentDir()).trusted)
    throw new Error(
      "Project must be trusted before project profiles can be changed",
    );
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status =
    message === "Access denied" || message.startsWith("Project must be trusted")
      ? 403
      : 400;
  return HttpResponse.json({ error: message }, { status });
}

export async function GET(req: Request) {
  try {
    const requestedCwd = requestSearchParams(req).get("cwd");
    if (!requestedCwd) {
      const profiles = listSubagentProfileSources(getAgentDir()).filter(
        (profile) => profile.scope === "builtin" || profile.scope === "global",
      );
      return HttpResponse.json({ profiles });
    }
    const cwd = await validateCwd(requestedCwd);
    return HttpResponse.json({ profiles: listSubagentProfileSources(cwd) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as {
      cwd?: unknown;
      scope?: unknown;
      profile?: Omit<SubagentProfile, "scope" | "filePath">;
    };
    const scope = validateScope(body.scope);
    const cwd = await validateCwdForScope(body.cwd, scope);
    assertWritableScopeTrusted(cwd, scope);
    if (!body.profile || typeof body.profile.name !== "string") {
      return HttpResponse.json({ error: "profile required" }, { status: 400 });
    }
    const profile = saveSubagentProfile(cwd, scope, body.profile);
    // 用户主动写入项目 profile 等价于信任该项目的这份本地配置；否则
    // 新增文件会立刻成为受限资源，导致其自身无法被后续运行时加载。
    if (scope === "project") trustProject(cwd, getAgentDir());
    return HttpResponse.json({ profile });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as {
      cwd?: unknown;
      scope?: unknown;
      name?: unknown;
      enabled?: unknown;
    };
    const scope = validateScope(body.scope);
    const cwd = await validateCwdForScope(body.cwd, scope);
    assertWritableScopeTrusted(cwd, scope);
    if (typeof body.name !== "string")
      return HttpResponse.json({ error: "name required" }, { status: 400 });
    if (typeof body.enabled !== "boolean")
      return HttpResponse.json({ error: "enabled required" }, { status: 400 });
    const name = body.name;
    const source = listSubagentProfileSources(cwd).find(
      (profile) =>
        profile.scope === scope &&
        profile.name.toLowerCase() === name.toLowerCase(),
    );
    if (!source)
      return HttpResponse.json(
        { error: "Agent profile not found" },
        { status: 404 },
      );
    const profile: Omit<SubagentProfile, "scope" | "filePath"> = {
      name: source.name,
      displayName: source.displayName,
      description: source.description,
      systemPrompt: source.systemPrompt,
      tools: source.tools,
      loadSkills: source.loadSkills,
      loadExtensions: source.loadExtensions,
      model: source.model,
      thinking: source.thinking,
      maxTurns: source.maxTurns,
      inheritContext: source.inheritContext,
      runInBackground: source.runInBackground,
      enabled: source.enabled,
    };
    return HttpResponse.json({
      profile: saveSubagentProfile(cwd, scope, {
        ...profile,
        enabled: body.enabled,
      }),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(req: Request) {
  try {
    const body = (await req.json()) as {
      cwd?: unknown;
      scope?: unknown;
      name?: unknown;
    };
    const scope = validateScope(body.scope);
    const cwd = await validateCwdForScope(body.cwd, scope);
    assertWritableScopeTrusted(cwd, scope);
    if (typeof body.name !== "string")
      return HttpResponse.json({ error: "name required" }, { status: 400 });
    deleteSubagentProfile(cwd, scope, body.name);
    return HttpResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
