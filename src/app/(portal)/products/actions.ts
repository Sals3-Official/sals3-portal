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
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import CjSupplierAdapter from '@/modules/suppliers/providers/cj/cj-adapter';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import {
  findConnectionBySellerAndProvider,
  findProviderByCode,
} from '@/modules/suppliers/repository';
import { CjApiError } from '@/services/cj/config';
import type { ReviewEvidence } from '@/lib/cj/evidence';

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

const checkRatingInputSchema = z.object({
  externalProductId: z.string().trim().min(1).max(200),
});

export type CheckCjRatingResult =
  { ok: true; reviews: ReviewEvidence } | { ok: false; reason: string };

/**
 * On-demand, single-product real CJ review check ("Check rating" button) -
 * the same evidence fetch (`getCandidateEvidence`) the automated pipeline
 * uses, just triggered by a click instead of a tick. Never bulk-fetched for
 * every row on the page: CJ allows one request per second per connection,
 * and this call alone costs three (product detail, stock, comments), so it
 * only ever runs for the one product a seller actually asks about.
 *
 * This is not the retired "Check for Sals3" action: it never touches
 * qualification. No candidate, evaluation, or snapshot row is written -
 * browsing (and this check) never creates DB records; only
 * "Customize & List" (not built yet) would.
 */
export async function checkCjRatingAction(
  input: unknown,
): Promise<CheckCjRatingResult> {
  const parsed = checkRatingInputSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, reason: 'invalid-input' };
  }

  const { sellerAccount } = await requireDropshipperAccount();
  const provider = await findProviderByCode(getDb(), 'CJ_DROPSHIPPING');
  const connection =
    provider === null
      ? null
      : await findConnectionBySellerAndProvider(
          getDb(),
          sellerAccount.id,
          provider.id,
        );

  if (
    connection === null ||
    connection.status === 'REVOKED' ||
    connection.status === 'DISCONNECTED'
  ) {
    return { ok: false, reason: 'no-connection' };
  }

  const secretStore = new PostgresSupplierSecretStore();
  const adapter = new CjSupplierAdapter(
    secretStore,
    new CjTokenManager(secretStore),
  );

  try {
    const evidence = await adapter.getCandidateEvidence(
      connection.id,
      parsed.data.externalProductId,
    );

    return { ok: true, reviews: evidence.reviews };
  } catch (error) {
    if (error instanceof CjApiError) {
      return { ok: false, reason: error.reason };
    }

    throw error;
  }
}
