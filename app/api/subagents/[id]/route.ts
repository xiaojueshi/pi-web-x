import { HttpResponse } from "@/src/server/http";
import {
  abortSubagent,
  getSubagentRun,
  steerSubagent,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

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

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = (await req.json()) as { action?: unknown; message?: unknown };
    if (body.action === "steer") {
      if (typeof body.message !== "string" || !body.message.trim()) {
        return HttpResponse.json(
          { error: "message required" },
          { status: 400 },
        );
      }
      await steerSubagent(id, body.message);
    } else if (body.action === "abort") {
      await abortSubagent(id);
    } else {
      return HttpResponse.json(
        { error: "action must be steer or abort" },
        { status: 400 },
      );
    }
    return HttpResponse.json({ ok: true, run: await getSubagentRun(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return HttpResponse.json(
      { error: message },
      { status: message.includes("not running") ? 409 : 500 },
    );
  }
}
