import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit, type RateLimitConfig } from '@/lib/rate-limit';
import type { PortalPermission } from '@/lib/auth/permissions';

/**
 * Shared authorization for the catalog draft actions.
 *
 * Extracted from `product-draft-actions.ts` when the bulk action arrived, and
 * deliberately NOT a `'use server'` module: every export of a `'use server'`
 * file becomes a client-invokable endpoint, and an importable-from-the-browser
 * `authorize()` would be an endpoint that exists only to be misused. A plain
 * module imported by both action files keeps it server-only.
 *
 * The checks, in order, none of which trust the browser: database presence
 * (CI/preview environments have none - degrade, do not throw), permission via
 * the session, the ADR-006 business-model gate (a Retailer holding
 * `product:import` still may not create supplier-backed records), then the
 * per-seller rate limit. The bucket is caller-supplied because one bulk call
 * can do the work of a hundred single calls - the two must not share a budget.
 */

export type Authorized = {
  ok: true;
  sellerAccountId: string;
  actorId: string;
};

export type AuthorizationFailure = {
  ok: false;
  reason: 'denied' | 'rate_limited' | 'not_configured';
};

export default async function authorizeDraftAction(
  permission: PortalPermission,
  rateLimitKey: string,
  rateLimit: RateLimitConfig,
): Promise<Authorized | AuthorizationFailure> {
  if (!isDatabaseConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  let session;

  try {
    session = await requirePermission(permission);
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };
    throw error;
  }

  if (session.sellerBusinessModel !== 'DROPSHIPPER') {
    return { ok: false, reason: 'denied' };
  }

  const limit = checkRateLimit(
    `${rateLimitKey}:${session.sellerId}`,
    rateLimit,
  );

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  return {
    ok: true,
    sellerAccountId: session.sellerId,
    actorId: session.userId,
  };
}
