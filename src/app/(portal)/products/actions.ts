'use server';

import { randomUUID } from 'crypto';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/rate-limit';
import { shortlistCandidateInputSchema } from '@/modules/catalog/candidates/contracts';
import shortlistCandidate from '@/modules/catalog/candidates/shortlist';

/**
 * "Check for Sals3" (spec section 8.11).
 *
 * Because the catalog tables now live in this app, this is a Server Action
 * rather than a cross-service HTTP call: one less network hop, and no shared
 * service credential to store or leak. Next.js verifies the request origin
 * for Server Actions, which covers the CSRF requirement for this mutation.
 *
 * The client passes only a CJ `pid`. Seller, actor, and market context come
 * from the verified server session.
 */

const RATE_LIMIT = { capacity: 20, refillIntervalMs: 60_000 };

/**
 * ADR-003 has not approved a launch market yet. This is a labelled
 * placeholder needed to satisfy the "at least one market" contract, not a
 * business fact — it must become a real seller-selected market before
 * anything is published.
 */
const PLACEHOLDER_MARKET_CODE = 'PH';

export type CheckForSals3Result =
  | {
      ok: true;
      candidateId: string;
      shortlistState: 'SHORTLISTED' | 'PREFLIGHT_PENDING';
      reused: boolean;
    }
  | {
      ok: false;
      reason:
        'invalid_input' | 'denied' | 'rate_limited' | 'conflict' | 'failed';
    };

export async function checkForSals3Candidate(
  externalProductId: string,
): Promise<CheckForSals3Result> {
  const parsedInput = shortlistCandidateInputSchema.safeParse({
    externalProductId,
  });

  if (!parsedInput.success) {
    return { ok: false, reason: 'invalid_input' };
  }

  let session;
  try {
    session = await requirePermission('catalog.candidate.shortlist');
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };
    throw error;
  }

  // Per-actor budget so one employee cannot exhaust everyone else's.
  const limit = checkRateLimit(
    `candidate:shortlist:${session.userId}`,
    RATE_LIMIT,
  );
  if (!limit.allowed) {
    return { ok: false, reason: 'rate_limited' };
  }

  try {
    const outcome = await shortlistCandidate(
      {
        supplier: 'CJ_DROPSHIPPING',
        externalProductId: parsedInput.data.externalProductId,
        intendedSellerId: session.sellerId,
        intendedMarketCodes: [PLACEHOLDER_MARKET_CODE],
        actorId: session.userId,
      },
      randomUUID(),
    );

    if (outcome.status === 'idempotency_conflict') {
      return { ok: false, reason: 'conflict' };
    }

    return {
      ok: true,
      candidateId: outcome.result.candidateId,
      shortlistState: outcome.result.shortlistState,
      reused: outcome.result.reused,
    };
  } catch (error) {
    // Structured server-side log only; the client gets a reason code with no
    // database detail, stack, or connection string.
    // eslint-disable-next-line no-console
    console.error('[portal] candidate shortlist failed', {
      externalProductId: parsedInput.data.externalProductId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}
