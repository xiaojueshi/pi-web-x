import { HttpResponse } from "@/src/server/http";
import { getSubagentRun } from "@/lib/rpc-manager";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const run = await getSubagentRun(id);
    if (!run)
      return HttpResponse.json(
        { error: "Subagent not found" },
        { status: 404 },
      );
    return HttpResponse.json({ run });
  } catch (error) {
    return HttpResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

/** 内置子会话仅供观察；人工 steer、终止及任何其他写入均被拒绝。 */
export function POST(
  _req: Request,
  _context: { params: Promise<{ id: string }> },
) {
  return HttpResponse.json(
    { error: "Subagent sessions are read-only", code: "subagent_read_only" },
    { status: 403 },
  );
}
