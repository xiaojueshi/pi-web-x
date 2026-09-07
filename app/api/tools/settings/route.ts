import { HttpResponse } from "@/src/server/http";
import {
  hasJsonContentType,
  isApiRequestAllowed,
} from "@/lib/request-security";
import {
  readPowerShellToolEnabled,
  writePowerShellToolEnabled,
} from "@/lib/powershell-settings";
import {
  readIdleSessionReapingSettings,
  writeIdleSessionReapingSettings,
} from "@/lib/idle-session-settings";
import { refreshRpcSessionIdleReapingTimers } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [powerShellEnabled, idleSessionReaping] = await Promise.all([
      readPowerShellToolEnabled(),
      readIdleSessionReapingSettings(),
    ]);
    return HttpResponse.json({
      isWindows: process.platform === "win32",
      powerShellEnabled,
      idleSessionReaping,
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
  try {
    const body = (await req.json()) as {
      enabled?: unknown;
      idleSessionReaping?: unknown;
    };
    if (body.idleSessionReaping !== undefined) {
      const idleSessionReaping = await writeIdleSessionReapingSettings(
        body.idleSessionReaping,
      );
      refreshRpcSessionIdleReapingTimers();
      return HttpResponse.json({
        isWindows: process.platform === "win32",
        powerShellEnabled: await readPowerShellToolEnabled(),
        idleSessionReaping,
      });
    }
    if (process.platform !== "win32") {
      return HttpResponse.json(
        { error: "PowerShell tool settings are only available on Windows" },
        { status: 404 },
      );
    }
    if (typeof body.enabled !== "boolean") {
      return HttpResponse.json(
        { error: "enabled must be a boolean" },
        { status: 400 },
      );
    }
    return HttpResponse.json({
      isWindows: true,
      powerShellEnabled: await writePowerShellToolEnabled(body.enabled),
      idleSessionReaping: await readIdleSessionReapingSettings(),
    });
  } catch (error) {
    return HttpResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
