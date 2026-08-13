'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';
import { can, PermissionError } from '@/lib/auth/permissions';
import { requireDropshipperAccount } from '@/lib/auth/seller-guard';
import { checkRateLimit } from '@/lib/rate-limit';
import getDb from '@/lib/db/client';
import { CANDIDATE_STATUS_COUNTS_TAG } from '@/modules/catalog/candidates/status-counts-cache';
import {
  appendAuditEvent,
  candidateBelongsToSeller,
  requeueForManualRecheck,
} from '@/modules/catalog/candidates/repository';
import { recordStockAttestation } from '@/modules/catalog/candidates/stock-review-repository';

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

    if (requeued) {
      // `updateTag`, not `revalidateTag`: this is a Server Action, and the
      // seller who just clicked "Recheck now" must see the row leave its bucket
      // on the response they are already waiting for - that is exactly the
      // read-your-own-writes semantic `updateTag` exists for. `revalidateTag`
      // with `'max'` would serve them the stale count once more.
      //
      // This action had no revalidation of any kind before.
      updateTag(CANDIDATE_STATUS_COUNTS_TAG);
    }

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

/**
 * Records a MANUAL CJ/MyCJ stock inspection against one raw supplier
 * candidate (ADR-013 §1a).
 *
 * This is an attestation by a person, not CJ API-verified evidence: it makes
 * no supplier request, spends no CJ points, and must never be presented as a
 * live stock check. There is deliberately no "check inventory through the CJ
 * API" action anywhere in this task - the approved interim decision is manual
 * website inspection only.
 *
 * Server-side controls, in order, none of which the UI is trusted to have
 * done: schema validation, authenticated seller account, explicit permission,
 * per-actor rate limit, exact ownership, then a compare-and-set write that
 * rejects a stale or duplicate submit. A cross-tenant candidate id, a missing
 * row, and a stale version all return the same `not_found_or_stale`, so a
 * probe learns nothing about another seller's catalogue.
 */

const ATTESTATION_RATE_LIMIT = { capacity: 30, refillIntervalMs: 60_000 };

/** Bounded so a note can never become a dumping ground for pasted credentials or payloads. */
const MAX_NOTE_LENGTH = 500;
const MAX_ORIGIN_LENGTH = 80;
/** A CJ warehouse can hold large counts; this only rejects absurd input. */
const MAX_OBSERVED_QUANTITY = 10_000_000;

/**
 * Redacts anything that looks like a credential or a bearer-style token
 * before a note is persisted. Defence in depth: the note is free text a
 * person types while looking at a supplier console, and it is rendered back
 * to other staff.
 */
function redactNote(note: string): string {
  return note
    .replace(
      /\b(?:token|key|secret|password|authorization|bearer|api[-_ ]?key)\b\s*[:=]?\s*\S+/gi,
      '[redacted]',
    )
    .slice(0, MAX_NOTE_LENGTH);
}

const stockAttestationSchema = z.object({
  candidateId: z.string().uuid(),
  state: z.enum([
    'MANUALLY_IN_STOCK',
    'MANUALLY_NO_INVENTORY',
    'MANUALLY_COULD_NOT_VERIFY',
  ]),
  /**
   * The version the page rendered. `STOCK_NOT_CHECKED` rows start at 0, so
   * this is a non-negative integer, not a positive one.
   */
  expectedVersion: z.coerce.number().int().min(0),
  observedQuantity: z.coerce
    .number()
    .int()
    .min(0)
    .max(MAX_OBSERVED_QUANTITY)
    .nullable()
    .optional(),
  observedOrigin: z
    .string()
    .trim()
    .max(MAX_ORIGIN_LENGTH)
    .nullable()
    .optional(),
  note: z.string().trim().max(MAX_NOTE_LENGTH).nullable().optional(),
});

export type StockAttestationInput = z.input<typeof stockAttestationSchema>;

export type RecordStockAttestationResult =
  | { ok: true; newVersion: number }
  | {
      ok: false;
      reason:
        | 'invalid_input'
        | 'denied'
        | 'rate_limited'
        | 'not_found_or_stale'
        | 'failed';
    };

export async function recordManualStockCheck(
  input: StockAttestationInput,
): Promise<RecordStockAttestationResult> {
  const parsed = stockAttestationSchema.safeParse(input);

  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  let session;
  let sellerAccount;
  try {
    ({ session, sellerAccount } = await requireDropshipperAccount());
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };
    throw error;
  }

  if (!can(session.role, 'catalog.candidate.stock_attest')) {
    return { ok: false, reason: 'denied' };
  }

  const limit = checkRateLimit(
    `candidate:stock-attest:${session.userId}`,
    ATTESTATION_RATE_LIMIT,
  );

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  const owned = await candidateBelongsToSeller(
    getDb(),
    parsed.data.candidateId,
    sellerAccount.id,
  );

  if (!owned) return { ok: false, reason: 'not_found_or_stale' };

  const note =
    parsed.data.note === null || parsed.data.note === undefined
      ? null
      : redactNote(parsed.data.note);

  try {
    const outcome = await getDb().transaction(async (tx) => {
      const written = await recordStockAttestation(tx, {
        candidateId: parsed.data.candidateId,
        sellerAccountId: sellerAccount.id,
        state: parsed.data.state,
        actorId: session.userId,
        // The person recorded what they saw now. A caller-supplied observed
        // time is deliberately NOT accepted: it would be an unverifiable
        // backdate on a record other staff rely on.
        observedAt: new Date(),
        observedQuantity: parsed.data.observedQuantity ?? null,
        observedOrigin: parsed.data.observedOrigin ?? null,
        note,
        expectedVersion: parsed.data.expectedVersion,
      });

      if (!written.ok) return written;

      await appendAuditEvent(tx, {
        actorId: session.userId,
        action: 'CANDIDATE_MANUAL_STOCK_ATTESTED',
        entityType: 'supplier_candidate',
        entityId: parsed.data.candidateId,
        payload: {
          state: parsed.data.state,
          observedQuantity: parsed.data.observedQuantity ?? null,
          observedOrigin: parsed.data.observedOrigin ?? null,
          supersededVersion: parsed.data.expectedVersion,
          // The note itself is intentionally not duplicated into the audit
          // payload - it lives once, redacted, on the attestation row.
          hasNote: note !== null && note !== '',
          evidenceKind: 'MANUAL_SUPPLIER_WEBSITE_INSPECTION',
          supplierApiCalled: false,
        },
      });

      return written;
    });

    if (!outcome.ok) return { ok: false, reason: 'not_found_or_stale' };

    revalidatePath('/products');

    return { ok: true, newVersion: outcome.newVersion };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] manual stock attestation failed', {
      candidateId: parsed.data.candidateId,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return { ok: false, reason: 'failed' };
  }
}
