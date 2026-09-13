import { HttpResponse } from "@/src/server/http";
import { previewSessionDelete } from "@/lib/session-deletion";

/** 返回删除影响范围及一次性确认 token；不修改任何 session JSONL。 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    return HttpResponse.json(await previewSessionDelete(id));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      (error as Error & { status?: number }).status ??
      (message === "Session not found" ? 404 : 400);
    return HttpResponse.json(
      {
        error: message,
        ...(message === "Session not found" ? { code: "not_found" } : {}),
      },
      { status },
    );
  }
}
