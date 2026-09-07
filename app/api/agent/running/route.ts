import { HttpResponse } from "@/src/server/http";
import {
  getCompletionNotificationSuppressedRpcSessionIds,
  getRunningRpcSessionIds,
} from "@/lib/rpc-manager";
import { getSessionListVersion } from "@/lib/session-reader";


// GET /api/agent/running - Lightweight snapshot for visible-tab polling.
export async function GET() {
  return HttpResponse.json(
    {
      sessionListVersion: getSessionListVersion(),
      runningSessionIds: getRunningRpcSessionIds(),
      completionNotificationSuppressedSessionIds:
        getCompletionNotificationSuppressedRpcSessionIds(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
