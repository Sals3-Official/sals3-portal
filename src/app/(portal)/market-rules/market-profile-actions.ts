'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import getDb from '@/lib/db/client';
import uniqueViolationConstraint from '@/lib/db/constraint-errors';
import { requirePermission } from '@/lib/auth/session';
import { PermissionError } from '@/lib/auth/permissions';
import { checkRateLimit } from '@/lib/rate-limit';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import {
  findAuthorizedDestination,
  resolveSellerMarketCapabilities,
} from '@/modules/market-config/capabilities';
import {
  createDraftProfile,
  transitionProfileForSeller,
} from '@/modules/market-config/repository';
import type { SellerMarketProfileStatus } from '@/lib/db/schema';

/**
 * Server actions for a seller's own market profile.
 *
 * Same discipline as `pricing-actions.ts`: Zod-validate, authorize,
 * rate-limit, then do the authorization lookup, the state change, and the
 * audit event inside one transaction.
 *
 * Two things arriving from the browser are never trusted as evidence. The
 * seller identity always comes from `session.sellerId`, never from input —
 * no action has a field for it. And the destination is only ever a candidate
 * string until `findAuthorizedDestination` returns it, so `SG`, `ID`, a
 * lowercase `au`, or an invented currency fails server-side regardless of
 * what the form rendered.
 */

const RATE_LIMIT = { capacity: 20, refillIntervalMs: 60_000 };
const MIN_REASON_LENGTH = 10;
const LIVE_PROFILE_CONSTRAINT = 'seller_market_profiles_live_key';

const reasonSchema = z
  .string()
  .trim()
  .min(MIN_REASON_LENGTH, 'Explain why in at least 10 characters.')
  .max(500);

/**
 * Shape-only. Membership of the pilot allowlist is decided by the capability
 * module, not by a Zod enum that would drift from it.
 */
const destinationCodeSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{2}$/, 'Choose a destination from the approved list.');

export type MarketProfileActionResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'invalid_input'
        | 'denied'
        | 'rate_limited'
        | 'not_found'
        | 'destination_not_authorized'
        | 'conflict'
        | 'failed';
    };

async function authorize(
  rateLimitKey: string,
): Promise<
  | { ok: true; sellerAccountId: string; actorId: string }
  | { ok: false; reason: 'denied' | 'rate_limited' }
> {
  let session;

  try {
    session = await requirePermission('market_profile:manage');
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };
    throw error;
  }

  const limit = checkRateLimit(
    `${rateLimitKey}:${session.sellerId}`,
    RATE_LIMIT,
  );
  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  return {
    ok: true,
    sellerAccountId: session.sellerId,
    actorId: session.userId,
  };
}

const beginSetupInputSchema = z.object({
  destinationCountryCode: destinationCodeSchema,
  reason: reasonSchema,
});

/**
 * Starts a profile as `DRAFT`. Nothing is activated implicitly: the global
 * AU+PH policy makes a destination *offerable*, never *configured*, so an
 * account stays unconfigured until someone sets it up on purpose and says
 * why.
 */
export async function beginMarketProfileSetupAction(
  input: unknown,
): Promise<MarketProfileActionResult> {
  const parsed = beginSetupInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize('market-profile:begin-setup');
  if (!auth.ok) return auth;

  const destination = findAuthorizedDestination(
    parsed.data.destinationCountryCode,
  );
  if (destination === null) {
    return { ok: false, reason: 'destination_not_authorized' };
  }

  const capabilities = resolveSellerMarketCapabilities();

  try {
    await getDb().transaction(async (tx) => {
      const row = await createDraftProfile(tx, {
        sellerAccountId: auth.sellerAccountId,
        destinationCountryCode: destination.destinationCountryCode,
        capabilityVersion: capabilities.capabilityVersion,
        source: capabilities.source,
        reason: parsed.data.reason,
        actorId: auth.actorId,
      });

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action: 'seller_market_profile.draft_created',
        entityType: 'SellerMarketProfile',
        entityId: row.id,
        payload: {
          sellerAccountId: row.sellerAccountId,
          destinationCountryCode: row.destinationCountryCode,
          capabilityVersion: row.capabilityVersion,
          status: row.status,
          version: row.version,
          reason: row.reason,
        },
      });
    });

    revalidatePath('/market-rules');
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown';

    // The partial unique index is the arbiter of "already being set up",
    // rather than a prior SELECT two concurrent submits would both pass.
    if (uniqueViolationConstraint(error) === LIVE_PROFILE_CONSTRAINT) {
      return { ok: false, reason: 'conflict' };
    }

    // eslint-disable-next-line no-console
    console.error('[portal] begin market profile setup failed', {
      error: message,
    });
    return { ok: false, reason: 'failed' };
  }
}

const transitionInputSchema = z.object({
  profileId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
  reason: reasonSchema,
});

type TransitionConfig = {
  expectedStatus: SellerMarketProfileStatus;
  nextStatus: SellerMarketProfileStatus;
  auditAction: string;
  rateLimitKey: string;
};

async function runTransition(
  input: unknown,
  config: TransitionConfig,
): Promise<MarketProfileActionResult> {
  const parsed = transitionInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  const auth = await authorize(config.rateLimitKey);
  if (!auth.ok) return auth;

  try {
    const outcome = await getDb().transaction(async (tx) => {
      const row = await transitionProfileForSeller(tx, {
        profileId: parsed.data.profileId,
        sellerAccountId: auth.sellerAccountId,
        expectedStatus: config.expectedStatus,
        expectedVersion: parsed.data.expectedVersion,
        nextStatus: config.nextStatus,
        reason: parsed.data.reason,
        actorId: auth.actorId,
      });

      // Another tenant's id, a profile that never existed, one already in a
      // different state, and a replayed submit all land here — same answer,
      // no mutation, no audit event claiming one happened.
      if (row === null) return { ok: false as const };

      await appendAuditEvent(tx, {
        actorId: auth.actorId,
        action: config.auditAction,
        entityType: 'SellerMarketProfile',
        entityId: row.id,
        payload: {
          sellerAccountId: row.sellerAccountId,
          destinationCountryCode: row.destinationCountryCode,
          capabilityVersion: row.capabilityVersion,
          previousStatus: config.expectedStatus,
          status: row.status,
          previousVersion: parsed.data.expectedVersion,
          version: row.version,
          reason: row.reason,
        },
      });

      return { ok: true as const };
    });

    if (!outcome.ok) return { ok: false, reason: 'not_found' };

    revalidatePath('/market-rules');
    return { ok: true };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] market profile transition failed', {
      action: config.auditAction,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}

export async function activateMarketProfileAction(
  input: unknown,
): Promise<MarketProfileActionResult> {
  return runTransition(input, {
    expectedStatus: 'DRAFT',
    nextStatus: 'ACTIVE',
    auditAction: 'seller_market_profile.activated',
    rateLimitKey: 'market-profile:activate',
  });
}

export async function suspendMarketProfileAction(
  input: unknown,
): Promise<MarketProfileActionResult> {
  return runTransition(input, {
    expectedStatus: 'ACTIVE',
    nextStatus: 'SUSPENDED',
    auditAction: 'seller_market_profile.suspended',
    rateLimitKey: 'market-profile:suspend',
  });
}
