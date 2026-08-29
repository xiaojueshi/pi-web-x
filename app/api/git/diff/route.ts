import { HttpRequest, HttpResponse } from "@/src/server/http";
import {
  getAllowedFileRoots,
  isExistingFilePathAllowed,
  isFilePathAllowed,
  isWindowsAbsolutePath,
} from "@/lib/file-access";
import { getGitFileDiff } from "@/lib/git-changes";

export async function GET(request: HttpRequest) {
  try {
    const cwd = request.nextUrl.searchParams.get("cwd")?.trim() ?? "";
    const filePath = request.nextUrl.searchParams.get("path")?.trim() ?? "";
    if (!cwd || (!cwd.startsWith("/") && !isWindowsAbsolutePath(cwd))) {
      return HttpResponse.json(
        { error: "cwd must be an absolute path" },
        { status: 400 },
      );
    }
    if (
      !filePath ||
      (!filePath.startsWith("/") && !isWindowsAbsolutePath(filePath))
    ) {
      return HttpResponse.json(
        { error: "path must be an absolute path" },
        { status: 400 },
      );
    }

    const allowedRoots = await getAllowedFileRoots();
    if (
      !isFilePathAllowed(cwd, allowedRoots) ||
      !isFilePathAllowed(filePath, allowedRoots)
    ) {
      return HttpResponse.json({ error: "Access denied" }, { status: 403 });
    }
    // The cwd must resolve inside an allowed root. The file itself may no
    // longer exist when Git reports it as deleted; getGitFileDiff verifies
    // that the requested path belongs to this repository and its status.
    if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
      return HttpResponse.json({ error: "Access denied" }, { status: 403 });
    }

    return HttpResponse.json(await getGitFileDiff(cwd, filePath));
  } catch (error) {
    return HttpResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
