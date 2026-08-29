import { stat } from "fs/promises";
import { resolve } from "path";
import { HttpResponse } from "@/src/server/http";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
} from "@/lib/file-access";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getProjectTrustStatus, trustProject } from "@/lib/project-trust";
import {
  destroyRpcSessionsForCwd,
  hasBusyRpcSessionForCwd,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

async function validateCwd(
  value: unknown,
): Promise<{ cwd: string } | { response: HttpResponse }> {
  if (typeof value !== "string" || !value.trim()) {
    return {
      response: HttpResponse.json({ error: "cwd required" }, { status: 400 }),
    };
  }

  const cwd = resolve(value);
  try {
    if (!(await stat(cwd)).isDirectory()) {
      return {
        response: HttpResponse.json(
          { error: "cwd must be a directory" },
          { status: 400 },
        ),
      };
    }
  } catch {
    return {
      response: HttpResponse.json(
        { error: "Directory does not exist" },
        { status: 400 },
      ),
    };
  }

  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return {
      response: HttpResponse.json({ error: "Access denied" }, { status: 403 }),
    };
  }
  return { cwd };
}

export async function GET(req: Request) {
  const result = await validateCwd(new URL(req.url).searchParams.get("cwd"));
  if ("response" in result) return result.response;
  return HttpResponse.json(getProjectTrustStatus(result.cwd, getAgentDir()));
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { cwd?: unknown };
    const result = await validateCwd(body.cwd);
    if ("response" in result) return result.response;

    const agentDir = getAgentDir();
    const current = getProjectTrustStatus(result.cwd, agentDir);
    if (!current.requiresTrust) {
      return HttpResponse.json(
        { error: "This project has no resources that require trust" },
        { status: 409 },
      );
    }
    if (hasBusyRpcSessionForCwd(result.cwd)) {
      return HttpResponse.json(
        {
          error:
            "Wait for the active session to finish before trusting this project",
        },
        { status: 409 },
      );
    }

    const status = trustProject(result.cwd, agentDir);
    invalidateModelsCache();
    await destroyRpcSessionsForCwd(result.cwd);
    return HttpResponse.json(status);
  } catch (error) {
    return HttpResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
