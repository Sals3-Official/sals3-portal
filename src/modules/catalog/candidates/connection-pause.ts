import type { SupplierConnectionRow } from '@/lib/db/schema';

/**
 * Stable `lastErrorCode` per non-workable connection status, so a seller
 * never sees a generic catch-all when their own connection is the reason a
 * candidate stopped progressing, and so a reconnect can find exactly the
 * rows it paused (`requeueConnectionPausedEvaluations` matches on these
 * exact values) without touching a genuinely unrelated technical failure
 * (e.g. `upstream-unavailable` from a CJ fetch error). Never derived from
 * `Availability` or decision `reasonCodes` - this is connection-health
 * vocabulary only, kept in its own module so `evaluate.ts` and the
 * repository's requeue helper share one definition instead of two hand-typed
 * copies drifting apart.
 */
export const CONNECTION_PAUSE_ERROR_CODES: Record<
  Exclude<SupplierConnectionRow['status'], 'CONNECTED' | 'DEGRADED'>,
  string
> = {
  PENDING: 'SUPPLIER_CONNECTION_PENDING',
  REAUTH_REQUIRED: 'SUPPLIER_CONNECTION_REAUTH_REQUIRED',
  DISCONNECTED: 'SUPPLIER_CONNECTION_DISCONNECTED',
  REVOKED: 'SUPPLIER_CONNECTION_REVOKED',
};

export const CONNECTION_PAUSE_ERROR_CODE_VALUES: readonly string[] =
  Object.values(CONNECTION_PAUSE_ERROR_CODES);
