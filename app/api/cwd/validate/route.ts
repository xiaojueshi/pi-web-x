import { HttpResponse } from "@/src/server/http";
import { statSync, type Stats } from "fs";
import { homedir } from "os";
import { isAbsolute, resolve } from "path";
import { allowFileRoot } from "@/lib/file-access";
import { projectIdentityKey } from "@/lib/project-identity";
import { resolveProject } from "@/lib/worktree";

function normalizeCwd(cwd: string): string {
  if (cwd === "~") return homedir();
  if (cwd.startsWith("~/")) return resolve(homedir(), cwd.slice(2));
  return isAbsolute(cwd) ? cwd : resolve(cwd);
}

// POST /api/cwd/validate  body: { cwd: string }
// Validates a candidate workspace before the UI selects it.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { cwd?: unknown };
    const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";

    if (!cwd) {
      return HttpResponse.json({ error: "Path is required" }, { status: 400 });
    }

    const normalizedCwd = normalizeCwd(cwd);
    let stat: Stats;
    try {
      stat = statSync(normalizedCwd);
    } catch {
      return HttpResponse.json(
        { error: `Directory does not exist: ${cwd}` },
        { status: 400 },
      );
    }

    if (!stat.isDirectory()) {
      return HttpResponse.json(
        { error: `Path is not a directory: ${cwd}` },
        { status: 400 },
      );
    }

    allowFileRoot(normalizedCwd);
    const project = await resolveProject(normalizedCwd);
    return HttpResponse.json({
      success: true,
      cwd: normalizedCwd,
      projectRoot: project.projectRoot,
      projectKey: projectIdentityKey(project.projectRoot),
    });
  } catch (error) {
    return HttpResponse.json({ error: String(error) }, { status: 500 });
  }
}
