import { HttpResponse } from "@/src/server/http";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
export async function GET() {
  return HttpResponse.json(
    {
      runningSessionIds: getRunningRpcSessionIds(),
      completionNotificationSuppressedSessionIds:
        getCompletionNotificationSuppressedRpcSessionIds(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
