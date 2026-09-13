/** A selected-chat lease is deliberately separate from extension liveness. */
export const SELECTED_SESSION_LEASE_TTL_MS = 90_000;

export interface LiveSessionLeaseHolder {
  sessionId: string;
  isAlive(): boolean;
}

interface Lease {
  holder: LiveSessionLeaseHolder;
  leaseId: string;
  expiresAt: number;
}

function leases(): Map<string, Lease> {
  const store = globalThis as typeof globalThis & {
    __piSelectedSessionLeases?: Map<string, Lease>;
  };
  return (store.__piSelectedSessionLeases ??= new Map());
}

/**
 * Renew a selected-chat lease for an already-live wrapper. This function never
 * starts a session; callers must obtain the wrapper before calling it.
 */
export function renewSelectedSessionLease(
  holder: LiveSessionLeaseHolder,
  leaseId: string,
  now = Date.now(),
): boolean {
  if (!holder.isAlive() || !leaseId) return false;
  leases().set(holder.sessionId, {
    holder,
    leaseId,
    expiresAt: now + SELECTED_SESSION_LEASE_TTL_MS,
  });
  return true;
}

/** Whether this exact live wrapper owns an unexpired selected-chat lease. */
export function hasSelectedSessionLease(
  holder: LiveSessionLeaseHolder,
  now = Date.now(),
): boolean {
  const lease = leases().get(holder.sessionId);
  if (!lease) return false;
  if (lease.holder !== holder || !holder.isAlive() || lease.expiresAt <= now) {
    if (lease.holder === holder || lease.expiresAt <= now)
      leases().delete(holder.sessionId);
    return false;
  }
  return true;
}

/** Forget the lease when its wrapper is torn down; useful outside the TTL too. */
export function clearSelectedSessionLease(
  holder: LiveSessionLeaseHolder,
  leaseId?: string,
): void {
  const lease = leases().get(holder.sessionId);
  if (
    lease?.holder === holder &&
    (leaseId === undefined || lease.leaseId === leaseId)
  )
    leases().delete(holder.sessionId);
}
