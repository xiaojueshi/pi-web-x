import { HttpResponse } from "@/src/server/http";
import {
  hasJsonContentType,
  isApiRequestAllowed,
} from "@/lib/request-security";
import {
  readPowerShellToolEnabled,
  writePowerShellToolEnabled,
} from "@/lib/powershell-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return HttpResponse.json({
      isWindows: process.platform === "win32",
      powerShellEnabled: await readPowerShellToolEnabled(),
    });
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
  if (process.platform !== "win32") {
    return HttpResponse.json(
      { error: "PowerShell tool settings are only available on Windows" },
      { status: 404 },
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
    return HttpResponse.json({
      isWindows: true,
      powerShellEnabled: await writePowerShellToolEnabled(body.enabled),
    });
  } catch (error) {
    return HttpResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
