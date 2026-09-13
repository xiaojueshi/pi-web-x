import { HttpResponse } from "@/src/server/http";
import { getRpcSession } from "@/lib/rpc-manager";
import {
  clearSelectedSessionLease,
  renewSelectedSessionLease,
  SELECTED_SESSION_LEASE_TTL_MS,
} from "@/lib/selected-session-lease";

/**
 * Renew the currently selected chat's in-memory lease. This only works with
 * an already-live wrapper; viewing persisted history never cold-starts it.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const leaseId = _request.headers.get("x-pi-selected-session-lease") ?? "";
  const session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    return HttpResponse.json(
      { error: "Live session not found", code: "live_session_required" },
      { status: 404 },
    );
  }
  if (!renewSelectedSessionLease(session, leaseId)) {
    return HttpResponse.json(
      { error: "Live session not found", code: "live_session_required" },
      { status: 404 },
    );
  }
  return HttpResponse.json({ ok: true, ttlMs: SELECTED_SESSION_LEASE_TTL_MS });
}

/** Release immediately when this chat is no longer selected. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const leaseId = _request.headers.get("x-pi-selected-session-lease") ?? "";
  const session = getRpcSession(id);
  if (session?.isAlive()) clearSelectedSessionLease(session, leaseId);
  return new HttpResponse(null, { status: 204 });
}
