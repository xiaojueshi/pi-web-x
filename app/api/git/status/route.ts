import fs from "fs";
import { HttpRequest, HttpResponse } from "@/src/server/http";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import { getGitStatus } from "@/lib/git-changes";

export async function GET(request: HttpRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return HttpResponse.json(
        { error: "cwd must be an absolute path" },
        { status: 400 },
      );
    }

    const allowedRoots = await getAllowedFileRoots();
    if (!isFilePathAllowed(cwd, allowedRoots)) {
      return HttpResponse.json({ error: "Access denied" }, { status: 403 });
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(cwd);
    } catch {
      return HttpResponse.json(
        { error: "Directory not found" },
        { status: 404 },
      );
    }
    if (!stat.isDirectory()) {
      return HttpResponse.json({ error: "Not a directory" }, { status: 400 });
    }
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return HttpResponse.json({ error: "Access denied" }, { status: 403 });
    }

    return HttpResponse.json(await getGitStatus(cwd));
  } catch (error) {
    return HttpResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
