import { HttpRequest, HttpResponse } from "@/src/server/http";
import { stat } from "fs/promises";
import {
  getBrowseStartDirectory,
  getParentDirectory,
  listDirectories,
  listWindowsDrives,
  resolveDirectory,
  shouldShowWindowsDrivePicker,
} from "@/lib/directory-browser";

// GET /api/cwd/browse?path=...：列出文件系统中的可读子目录。
export async function GET(request: HttpRequest) {
  try {
    const requested = request.nextUrl.searchParams.get("path")?.trim();

    if (shouldShowWindowsDrivePicker(requested)) {
      return HttpResponse.json({
        path: "",
        parentPath: null,
        drives: await listWindowsDrives(),
        directories: [],
      });
    }

    const candidate = getBrowseStartDirectory(requested);

    let resolved: string;
    try {
      resolved = await resolveDirectory(candidate);
    } catch {
      return HttpResponse.json(
        { error: "Directory does not exist" },
        { status: 404 },
      );
    }

    const directoryStat = await stat(resolved);
    if (!directoryStat.isDirectory()) {
      return HttpResponse.json(
        { error: "Path is not a directory" },
        { status: 400 },
      );
    }

    const directories = await listDirectories(resolved);

    return HttpResponse.json({
      path: resolved,
      parentPath: getParentDirectory(resolved),
      directories,
    });
  } catch (error) {
    return HttpResponse.json({ error: String(error) }, { status: 500 });
  }
}
