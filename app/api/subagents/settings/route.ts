import { HttpResponse } from "@/src/server/http";
import {
  hasJsonContentType,
  isApiRequestAllowed,
} from "@/lib/request-security";
import {
  readSubagentSettings,
  writeBuiltInSubagentsEnabled,
} from "@/lib/subagent-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const settings = readSubagentSettings();
    return HttpResponse.json({ enabled: settings.builtInEnabled });
  } catch (error) {
    return HttpResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}

export async function PUT(req: Request) {
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
    const body = (await req.json()) as { enabled?: unknown };
    if (typeof body.enabled !== "boolean") {
      return HttpResponse.json(
        { error: "enabled must be a boolean" },
        { status: 400 },
      );
    }
    const settings = writeBuiltInSubagentsEnabled(body.enabled);
    return HttpResponse.json({ enabled: settings.builtInEnabled });
  } catch (error) {
    return HttpResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
