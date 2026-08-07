'use server';

import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { checkRateLimit } from '@/lib/rate-limit';
import getDb from '@/lib/db/client';
import {
  appendAuditEvent,
  candidateBelongsToSeller,
  requeueForManualRecheck,
} from '@/modules/catalog/candidates/repository';

/**
 * "Recheck now" (spec: retryable Blocked/Rejected and Evaluating rows only,
 * "for debugging/admin use only").
 *
 * The seller-facing per-row "Check for Sals3" action from the manual-only
 * flow is gone: candidates are now shortlisted and evaluated automatically
 * by the CJ feed ingestion + evaluation pipeline
 * (`src/modules/catalog/candidates/run-tick.ts`, invoked by a GitHub Actions
 * schedule - see `.github/workflows/evaluate-tick.yml`). This action only nudges an already-queued pipeline to
 * retry a specific candidate sooner than its scheduled backoff; it never
 * creates a candidate or fetches CJ evidence itself.
 */

const RATE_LIMIT = { capacity: 20, refillIntervalMs: 60_000 };

export type RecheckCandidateResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        'invalid_input' | 'denied' | 'rate_limited' | 'not_eligible' | 'failed';
    };

export async function recheckCandidateNow(
  candidateId: string,
): Promise<RecheckCandidateResult> {
  const parsedInput = z.string().uuid().safeParse(candidateId);

  if (!parsedInput.success) {
    return { ok: false, reason: 'invalid_input' };
  }

  let session;
  let sellerAccount;
  try {
    ({ session, sellerAccount } = await requireDropshipperAccount());
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };
    throw error;
  }

  const limit = checkRateLimit(
    `candidate:recheck:${session.userId}`,
    RATE_LIMIT,
  );
  if (!limit.allowed) {
    return { ok: false, reason: 'rate_limited' };
  }

  // Tenant check before any mutation - a seller can only recheck their own
  // candidate, never one reachable by guessing/passing another seller's id.
  const owned = await candidateBelongsToSeller(
    getDb(),
    parsedInput.data,
    sellerAccount.id,
  );

  if (!owned) {
    return { ok: false, reason: 'not_eligible' };
  }

  try {
    const requeued = await getDb().transaction(async (tx) => {
      const eligible = await requeueForManualRecheck(tx, parsedInput.data);

      if (eligible) {
        await appendAuditEvent(tx, {
          actorId: session.userId,
          action: 'CANDIDATE_RECHECK_REQUESTED',
          entityType: 'supplier_candidate',
          entityId: parsedInput.data,
          payload: {},
        });
      }

      return eligible;
    });

    return requeued ? { ok: true } : { ok: false, reason: 'not_eligible' };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] candidate recheck failed', {
      candidateId: parsedInput.data,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}
