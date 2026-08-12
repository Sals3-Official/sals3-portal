import { and, eq, gt, inArray, isNull, lt, ne, or, sql } from 'drizzle-orm';
import type { DbExecutor, DbTransaction } from '@/lib/db/client';
import {
  auditEvents,
  candidateEvaluations,
  idempotencyRecords,
  supplierCandidates,
  supplierConnections,
  supplierSnapshots,
  type CandidateEvaluationRow,
  type IdempotencyRecordRow,
  type SupplierCandidateRow,
  type SupplierSnapshotRow,
} from '@/lib/db/schema';
import { CONNECTION_PAUSE_ERROR_CODE_VALUES } from './connection-pause';
import type { Decision } from './rules/decide';
import type { EvidenceSummary, FeedSnapshot } from './rules/contracts';
import {
  MAX_EVALUATION_ATTEMPTS,
  nextRefreshAtFor,
  nextRetryDelayMs,
} from './rules/policy';

/**
 * Data access for the candidate shortlist. Every statement is parameterized
 * by Drizzle — no string-built SQL anywhere.
 *
 * Each function accepts an `Executor` so it can run either standalone or
 * inside a transaction, which lets `shortlist.ts` make the whole step atomic
 * without this file knowing about transaction control.
 */

export type Executor = DbExecutor;

/**
 * Atomic create-or-nothing on the `(supplier, external_product_id)` unique
 * index. Returns the new row, or `null` when a row already existed.
 *
 * This is deliberately an upsert rather than "select then insert": two
 * concurrent clicks on the same CJ row would both pass a prior existence
 * check and one would then fail on the constraint. Letting Postgres arbitrate
 * removes that race entirely.
 */
export async function insertCandidateIfAbsent(
  executor: Executor,
  input: {
    supplier: 'CJ_DROPSHIPPING';
    externalProductId: string;
    intendedSellerId: string;
    /** ADR-008: which seller's own connection this candidate came from. */
    supplierConnectionId: string;
    intendedMarketCodes: string[];
    actorId: string;
    /** Provider category identity/label from the discovering feed row. */
    providerCategoryId?: string | null;
    providerCategoryName?: string | null;
  },
): Promise<SupplierCandidateRow | null> {
  const inserted = await executor
    .insert(supplierCandidates)
    .values({
      supplier: input.supplier,
      externalProductId: input.externalProductId,
      intendedSellerId: input.intendedSellerId,
      supplierConnectionId: input.supplierConnectionId,
      intendedMarketCodes: input.intendedMarketCodes,
      providerCategoryId: input.providerCategoryId ?? null,
      providerCategoryName: input.providerCategoryName ?? null,
      createdBy: input.actorId,
      providerLastSeenAt: new Date(),
      providerLastVerifiedAt: new Date(),
    })
    // Connection-scoped as of Migration B (0004): two sellers' own
    // connections can each shortlist the same CJ pid independently.
    .onConflictDoNothing({
      target: [
        supplierCandidates.supplierConnectionId,
        supplierCandidates.externalProductId,
      ],
    })
    .returning();

  return inserted[0] ?? null;
}

export async function markCandidateProviderSeen(
  executor: Executor,
  candidateId: string,
  /**
   * Re-observed provider category. Refreshed on every sighting so the local
   * Category filter tracks CJ's current taxonomy without a separate call;
   * omitted (or null) leaves the stored value alone rather than erasing it.
   */
  category?: { id: string | null; name: string | null },
): Promise<void> {
  await executor
    .update(supplierCandidates)
    .set({
      providerLastSeenAt: new Date(),
      providerLastVerifiedAt: new Date(),
      providerRemovalSuspectedAt: null,
      ...(category?.id == null ? {} : { providerCategoryId: category.id }),
      ...(category?.name == null
        ? {}
        : { providerCategoryName: category.name }),
      updatedAt: new Date(),
    })
    .where(eq(supplierCandidates.id, candidateId));
}

export async function markCandidateRemovalSuspected(
  executor: Executor,
  input: { candidateId: string; suspectedAt: Date },
): Promise<void> {
  await executor
    .update(supplierCandidates)
    .set({
      providerRemovalSuspectedAt: input.suspectedAt,
      updatedAt: new Date(),
    })
    .where(eq(supplierCandidates.id, input.candidateId));
}

export async function markCandidateRemovalConfirmed(
  executor: Executor,
  input: { candidateId: string; confirmedAt: Date },
): Promise<void> {
  await executor
    .update(supplierCandidates)
    .set({
      providerRemovalConfirmedAt: input.confirmedAt,
      updatedAt: new Date(),
    })
    .where(eq(supplierCandidates.id, input.candidateId));
}

export async function findCandidateById(
  executor: Executor,
  candidateId: string,
): Promise<SupplierCandidateRow | null> {
  const rows = await executor
    .select()
    .from(supplierCandidates)
    .where(eq(supplierCandidates.id, candidateId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Tenant-scoped: confirms `candidateId` belongs to a connection owned by
 * `sellerAccountId`, in the same query as the lookup - never a separate
 * check-then-fetch. Used before any seller-triggered mutation on a specific
 * candidate (e.g. "Recheck now"), so one seller can never act on another's
 * row by guessing/passing an arbitrary id.
 */
export async function candidateBelongsToSeller(
  executor: Executor,
  candidateId: string,
  sellerAccountId: string,
): Promise<boolean> {
  const rows = await executor
    .select({ id: supplierCandidates.id })
    .from(supplierCandidates)
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .where(
      and(
        eq(supplierCandidates.id, candidateId),
        eq(supplierConnections.sellerAccountId, sellerAccountId),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/**
 * Connection-scoped as of Migration B (0004): uniqueness is now
 * `(supplier_connection_id, external_product_id)`, not the old global
 * `(supplier, external_product_id)` - see `insertCandidateIfAbsent`'s
 * conflict target.
 */
export async function findCandidateByConnectionAndExternalId(
  executor: Executor,
  supplierConnectionId: string,
  externalProductId: string,
): Promise<SupplierCandidateRow | null> {
  const rows = await executor
    .select()
    .from(supplierCandidates)
    .where(
      and(
        eq(supplierCandidates.supplierConnectionId, supplierConnectionId),
        eq(supplierCandidates.externalProductId, externalProductId),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/** Append-only (spec section 5.3). No update or delete helper exists here. */
export async function appendAuditEvent(
  executor: Executor,
  event: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await executor.insert(auditEvents).values(event);
}

/**
 * One snapshot per candidate: a re-check replaces the previous evidence,
 * because stale evidence has no consumer and unbounded history would grow for
 * nothing. Uses an upsert so a re-check cannot race into a duplicate.
 */
export async function upsertSnapshot(
  executor: Executor,
  snapshot: {
    candidateId: string;
    schemaVersion: string;
    checksum: string;
    evidence: unknown;
    capturedAt: Date;
  },
): Promise<void> {
  await executor
    .insert(supplierSnapshots)
    .values(snapshot)
    .onConflictDoUpdate({
      target: supplierSnapshots.candidateId,
      set: {
        schemaVersion: snapshot.schemaVersion,
        checksum: snapshot.checksum,
        evidence: snapshot.evidence,
        capturedAt: snapshot.capturedAt,
      },
    });
}

export async function findSnapshotByCandidateId(
  executor: Executor,
  candidateId: string,
): Promise<SupplierSnapshotRow | null> {
  const rows = await executor
    .select()
    .from(supplierSnapshots)
    .where(eq(supplierSnapshots.candidateId, candidateId))
    .limit(1);

  return rows[0] ?? null;
}

export async function findIdempotencyRecord(
  executor: Executor,
  key: string,
): Promise<IdempotencyRecordRow | null> {
  const rows = await executor
    .select()
    .from(idempotencyRecords)
    .where(eq(idempotencyRecords.key, key))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Create-or-nothing so two concurrent requests carrying the same key cannot
 * both write a record. Returns `false` when a record already existed.
 */
// --- Candidate evaluation (automated pipeline) -----------------------------

/**
 * Ingestion insert: creates a QUEUED evaluation row for a brand-new
 * candidate. A no-op when one already exists (`onConflictDoNothing` on the
 * `candidate_id` unique index) - ingestion runs repeatedly and must never
 * duplicate or reset an in-flight/decided evaluation.
 */
export async function insertQueuedEvaluationIfAbsent(
  executor: Executor,
  input: {
    candidateId: string;
    feedSnapshot: FeedSnapshot;
    fingerprint: string;
    policyVersion: string;
  },
): Promise<void> {
  await executor
    .insert(candidateEvaluations)
    .values({
      candidateId: input.candidateId,
      status: 'QUEUED',
      admissionReason: 'NEW_PRODUCT',
      feedSnapshot: input.feedSnapshot,
      lastSeenFingerprint: input.fingerprint,
      policyVersion: input.policyVersion,
    })
    .onConflictDoNothing({ target: candidateEvaluations.candidateId });
}

/**
 * Ingestion re-queue: a previously decided candidate (`PASS`,
 * `PASS_WITH_ATTENTION`, or `BLOCKED`) whose CJ feed fingerprint changed goes
 * back to `QUEUED` for a fresh evaluation. Resets attempt/error state because
 * this is new data, not a retry of the same failure. A no-op when the
 * fingerprint is unchanged or the row is currently `QUEUED`/`EVALUATING`
 * (never interrupt in-flight work).
 */
export async function requeueIfFingerprintChanged(
  executor: Executor,
  input: {
    candidateId: string;
    feedSnapshot: FeedSnapshot;
    fingerprint: string;
  },
): Promise<boolean> {
  const updated = await executor
    .update(candidateEvaluations)
    .set({
      status: 'QUEUED',
      admissionReason: 'MATERIAL_SOURCE_CHANGE',
      feedSnapshot: input.feedSnapshot,
      lastSeenFingerprint: input.fingerprint,
      attemptCount: 0,
      lastErrorCode: null,
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(candidateEvaluations.candidateId, input.candidateId),
        ne(candidateEvaluations.lastSeenFingerprint, input.fingerprint),
        or(
          eq(candidateEvaluations.status, 'PASS'),
          eq(candidateEvaluations.status, 'PASS_WITH_ATTENTION'),
          eq(candidateEvaluations.status, 'BLOCKED'),
          eq(candidateEvaluations.status, 'TEMPORARILY_INELIGIBLE'),
        ),
      ),
    )
    .returning({ id: candidateEvaluations.id });

  return updated.length > 0;
}

export async function findEvaluationByCandidateId(
  executor: Executor,
  candidateId: string,
): Promise<CandidateEvaluationRow | null> {
  const rows = await executor
    .select()
    .from(candidateEvaluations)
    .where(eq(candidateEvaluations.candidateId, candidateId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Requeues candidates whose retry backoff has elapsed
 * (`TEMPORARILY_INELIGIBLE` or `EVALUATION_FAILED`, under the max attempt
 * count - past that they stay put and surface in the Exception Queue as
 * dead letters instead).
 */
export async function requeueDueRetries(
  executor: Executor,
  limit: number,
): Promise<number> {
  const due = await executor
    .select({ id: candidateEvaluations.id })
    .from(candidateEvaluations)
    .where(
      and(
        or(
          eq(candidateEvaluations.status, 'TEMPORARILY_INELIGIBLE'),
          eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
        ),
        lt(candidateEvaluations.nextRetryAt, new Date()),
        lt(candidateEvaluations.attemptCount, MAX_EVALUATION_ATTEMPTS),
      ),
    )
    .limit(limit);

  if (due.length === 0) return 0;

  await executor
    .update(candidateEvaluations)
    .set({
      status: 'QUEUED',
      admissionReason: 'RETRY_DUE',
      updatedAt: new Date(),
    })
    .where(
      inArray(
        candidateEvaluations.id,
        due.map((row) => row.id),
      ),
    );

  return due.length;
}

/**
 * Bounded default so one reconnect can never enqueue an unbounded scan of a
 * seller's whole history in one request/transaction.
 */
const RECONNECT_REQUEUE_BATCH_SIZE = 50;

/**
 * ADR-007's "reconnect and resume evaluation... performs a bounded requeue
 * through Evaluating before any row can return to Ready": matches only rows
 * this exact connection's own pause caused (`EVALUATION_FAILED` with one of
 * `CONNECTION_PAUSE_ERROR_CODE_VALUES`, never a genuinely unrelated
 * technical failure like a CJ fetch timeout), and only ever moves them back
 * to `QUEUED` for a fresh full evaluation - never directly to `PASS`/Ready,
 * so reconnecting can never falsely restore a candidate without re-running
 * every current gate. Idempotent by construction: once a row leaves
 * `EVALUATION_FAILED` here, it no longer matches this `WHERE` clause, so
 * calling this twice for the same connection cannot double-requeue it or
 * duplicate any row.
 */
export async function requeueConnectionPausedEvaluations(
  executor: Executor,
  supplierConnectionId: string,
  limit = RECONNECT_REQUEUE_BATCH_SIZE,
): Promise<number> {
  const paused = await executor
    .select({ id: candidateEvaluations.id })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .where(
      and(
        eq(supplierCandidates.supplierConnectionId, supplierConnectionId),
        eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
        inArray(candidateEvaluations.lastErrorCode, [
          ...CONNECTION_PAUSE_ERROR_CODE_VALUES,
        ]),
      ),
    )
    .limit(limit);

  if (paused.length === 0) return 0;

  await executor
    .update(candidateEvaluations)
    .set({
      status: 'QUEUED',
      admissionReason: 'CONNECTION_RESTORED',
      attemptCount: 0,
      lastErrorCode: null,
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    .where(
      inArray(
        candidateEvaluations.id,
        paused.map((row) => row.id),
      ),
    );

  return paused.length;
}

/**
 * Claims up to `batchSize` evaluable rows for `workerId`: newly `QUEUED`
 * rows, or `EVALUATING` rows whose lease expired (a crashed/killed worker).
 * `FOR UPDATE SKIP LOCKED` inside one transaction is both the idempotency
 * guard (two concurrent claimers never receive the same row) and the expired
 * lease recovery - no separate sweep job needed. Must run inside
 * `getDb().transaction(...)` so the row locks from the `SELECT` are held
 * until the following `UPDATE` commits.
 */
export async function claimEvaluationBatch(
  tx: DbTransaction,
  input: { workerId: string; batchSize: number; leaseDurationMs: number },
): Promise<CandidateEvaluationRow[]> {
  const claimable = await tx
    .select({ id: candidateEvaluations.id })
    .from(candidateEvaluations)
    .where(
      or(
        eq(candidateEvaluations.status, 'QUEUED'),
        and(
          eq(candidateEvaluations.status, 'EVALUATING'),
          lt(candidateEvaluations.leasedUntil, new Date()),
        ),
      ),
    )
    .orderBy(candidateEvaluations.createdAt)
    .limit(input.batchSize)
    .for('update', { skipLocked: true });

  if (claimable.length === 0) return [];

  return tx
    .update(candidateEvaluations)
    .set({
      status: 'EVALUATING',
      leasedBy: input.workerId,
      leasedUntil: new Date(Date.now() + input.leaseDurationMs),
      updatedAt: new Date(),
    })
    .where(
      inArray(
        candidateEvaluations.id,
        claimable.map((row) => row.id),
      ),
    )
    .returning();
}

/**
 * Manual "Recheck now" (debug/admin use only, per spec). Only eligible from
 * `TEMPORARILY_INELIGIBLE` or `EVALUATION_FAILED` - a permanent `BLOCKED`
 * decision has no override, and `QUEUED`/`EVALUATING`/decided rows are left
 * alone. Returns whether the row was actually eligible and requeued.
 */
export async function requeueForManualRecheck(
  executor: Executor,
  candidateId: string,
): Promise<boolean> {
  const updated = await executor
    .update(candidateEvaluations)
    .set({ status: 'QUEUED', nextRetryAt: null, updatedAt: new Date() })
    .where(
      and(
        eq(candidateEvaluations.candidateId, candidateId),
        or(
          eq(candidateEvaluations.status, 'TEMPORARILY_INELIGIBLE'),
          eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
        ),
      ),
    )
    .returning({ id: candidateEvaluations.id });

  return updated.length > 0;
}

/**
 * Persists a completed decision (PASS / PASS_WITH_ATTENTION / BLOCKED /
 * TEMPORARILY_INELIGIBLE).
 *
 * `TEMPORARILY_INELIGIBLE` is the one status that schedules its own
 * automatic retry here, exactly like `recordEvaluationFailure` does for a
 * technical failure - `decide.ts`/`contracts.ts` already document it as
 * "auto-retried," but until this fix nothing actually set `nextRetryAt` for
 * it, so `requeueDueRetries`'s `lt(nextRetryAt, now())` filter could never
 * match it (`NULL < now()` is neither true nor false in SQL). `attemptCount`
 * is shared with the technical-failure counter and the same
 * `MAX_EVALUATION_ATTEMPTS` cap - past the cap it simply stops auto-
 * retrying (still visible on Blocked/Rejected, since its `status` column
 * never changes; "Recheck now" still works). Every other decision resets
 * `attemptCount` to 0 and clears `nextRetryAt`, since a real qualification
 * pass/fail is not a retry-eligible state.
 */
export async function recordEvaluationDecision(
  executor: Executor,
  input: {
    candidateId: string;
    decision: Decision;
    evidenceSummary: EvidenceSummary;
    sourceSnapshotChecksum: string;
    policyVersion: string;
    lastKnownPriceUsdCents: number | null;
    /** The row's `attemptCount` before this decision - only read when the decision is `TEMPORARILY_INELIGIBLE`. */
    attemptCount: number;
  },
): Promise<void> {
  const isTemporarilyIneligible =
    input.decision.status === 'TEMPORARILY_INELIGIBLE';
  const nextAttemptCount = isTemporarilyIneligible ? input.attemptCount + 1 : 0;
  const exhausted =
    isTemporarilyIneligible && nextAttemptCount >= MAX_EVALUATION_ATTEMPTS;

  await executor
    .update(candidateEvaluations)
    .set({
      status: input.decision.status,
      reasonCodes: input.decision.reasonCodes,
      evidenceSummary: input.evidenceSummary,
      sourceSnapshotChecksum: input.sourceSnapshotChecksum,
      policyVersion: input.policyVersion,
      lastKnownPriceUsdCents: input.lastKnownPriceUsdCents,
      leasedBy: null,
      leasedUntil: null,
      attemptCount: nextAttemptCount,
      lastErrorCode: null,
      nextRetryAt:
        isTemporarilyIneligible && !exhausted
          ? new Date(Date.now() + nextRetryDelayMs(nextAttemptCount))
          : null,
      // Freshness deadline (ADR-010 §12.2): every decided row gets its
      // tier's reconciliation deadline; permanent BLOCKED stays null.
      nextRefreshAt: nextRefreshAtFor(input.decision.status),
      evaluatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(candidateEvaluations.candidateId, input.candidateId));
}

/** Persists a screening-stage BLOCKED/TEMPORARILY_INELIGIBLE decision made without an evidence fetch. */
export async function recordScreeningDecision(
  executor: Executor,
  input: { candidateId: string; decision: Decision; policyVersion: string },
): Promise<void> {
  await executor
    .update(candidateEvaluations)
    .set({
      status: input.decision.status,
      reasonCodes: input.decision.reasonCodes,
      policyVersion: input.policyVersion,
      leasedBy: null,
      leasedUntil: null,
      attemptCount: 0,
      lastErrorCode: null,
      nextRetryAt: null,
      nextRefreshAt: nextRefreshAtFor(input.decision.status),
      evaluatedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(candidateEvaluations.candidateId, input.candidateId));
}

/** Records a failed evidence fetch/parse and schedules (or exhausts) a retry. */
export async function recordEvaluationFailure(
  executor: Executor,
  input: {
    candidateId: string;
    attemptCount: number;
    lastErrorCode: string;
    nextRetryAt: Date | null;
  },
): Promise<void> {
  await executor
    .update(candidateEvaluations)
    .set({
      status: 'EVALUATION_FAILED',
      attemptCount: input.attemptCount,
      lastErrorCode: input.lastErrorCode,
      nextRetryAt: input.nextRetryAt,
      // Even an exhausted failure keeps a freshness floor, so it reconciles
      // and can reopen instead of becoming a permanent blind spot.
      nextRefreshAt: nextRefreshAtFor('EVALUATION_FAILED'),
      leasedBy: null,
      leasedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(candidateEvaluations.candidateId, input.candidateId));
}

/**
 * Queue-consumer claim for ONE candidate's evaluation (the EVALUATE_CANDIDATE
 * handler's admission gate). Claimable states, all under `FOR UPDATE` so two
 * concurrent deliveries can never both win:
 *
 * - `QUEUED` - normal admission;
 * - `EVALUATING` with an expired lease - crashed-worker recovery;
 * - `TEMPORARILY_INELIGIBLE`/`EVALUATION_FAILED` whose `nextRetryAt` has
 *   passed, under the attempt cap - the queue-delayed retry admission
 *   (`RETRY_DUE`), replacing the old cron-tick `requeueDueRetries` scan.
 *
 * Anything else (in-flight with a live lease, decided fresh rows, exhausted
 * dead letters) returns null and the duplicate delivery acknowledges as a
 * no-op - at-least-once delivery can never create a duplicate logical
 * evidence decision.
 */
export async function claimEvaluationByCandidateId(
  tx: DbTransaction,
  input: { candidateId: string; workerId: string; leaseDurationMs: number },
): Promise<CandidateEvaluationRow | null> {
  const now = new Date();
  const rows = await tx
    .select()
    .from(candidateEvaluations)
    .where(eq(candidateEvaluations.candidateId, input.candidateId))
    .limit(1)
    .for('update');

  const row = rows[0];

  if (row === undefined) return null;

  const isQueued = row.status === 'QUEUED';
  const isExpiredEvaluating =
    row.status === 'EVALUATING' &&
    (row.leasedUntil === null || row.leasedUntil <= now);
  const isDueRetry =
    (row.status === 'TEMPORARILY_INELIGIBLE' ||
      row.status === 'EVALUATION_FAILED') &&
    row.nextRetryAt !== null &&
    row.nextRetryAt <= now &&
    row.attemptCount < MAX_EVALUATION_ATTEMPTS;

  if (!isQueued && !isExpiredEvaluating && !isDueRetry) return null;

  const claimed = await tx
    .update(candidateEvaluations)
    .set({
      status: 'EVALUATING',
      ...(isDueRetry ? { admissionReason: 'RETRY_DUE' as const } : {}),
      leasedBy: input.workerId,
      leasedUntil: new Date(now.getTime() + input.leaseDurationMs),
      updatedAt: now,
    })
    .where(eq(candidateEvaluations.id, row.id))
    .returning();

  return claimed[0] ?? null;
}

/**
 * Releases a claim WITHOUT consuming an attempt - used when the points/rate
 * budget refuses the work before any supplier call was made. The row goes
 * back to `QUEUED` and the caller schedules a delayed queue continuation.
 */
export async function releaseEvaluationClaim(
  executor: Executor,
  input: { candidateId: string; workerId: string; lastErrorCode: string },
): Promise<void> {
  await executor
    .update(candidateEvaluations)
    .set({
      status: 'QUEUED',
      leasedBy: null,
      leasedUntil: null,
      lastErrorCode: input.lastErrorCode,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(candidateEvaluations.candidateId, input.candidateId),
        eq(candidateEvaluations.leasedBy, input.workerId),
        eq(candidateEvaluations.status, 'EVALUATING'),
      ),
    );
}

/**
 * Freshness sweep (ADR-010 §12.2): decided rows whose `nextRefreshAt` has
 * passed go back to `QUEUED` with admission `EVIDENCE_EXPIRED`, bounded per
 * call. Returns the requeued candidate ids so the caller can enqueue their
 * evaluation messages in the same transaction.
 */
/**
 * The historical-freeze bound shared by the automatic requeue tiers.
 *
 * `discovery_backlog_gates.activation_at` is the durable line between the
 * pipeline that existed when the lean intake policy activated and everything
 * discovered since. Passing it here stops the automatic tiers from re-opening
 * historical rows forever: every `QUEUED` row counts as active work, and the
 * intake gate refuses a new `product/list` request while active work exists,
 * so an unbounded tier with a large historical pool blocks new discovery
 * permanently rather than temporarily.
 *
 * `undefined` means unbounded, which is both the previous behaviour and the
 * right one for a connection with no history to freeze - and for the
 * owner-triggered recheck, which must still be able to reach frozen rows.
 */
function createdAfterBound(createdAfter: Date | undefined) {
  return createdAfter === undefined
    ? undefined
    : gt(supplierCandidates.createdAt, createdAfter);
}

export async function requeueDueRefreshes(
  executor: Executor,
  supplierConnectionId: string,
  limit: number,
  createdAfter?: Date,
): Promise<string[]> {
  const due = await executor
    .select({
      id: candidateEvaluations.id,
      candidateId: candidateEvaluations.candidateId,
    })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .where(
      and(
        eq(supplierCandidates.supplierConnectionId, supplierConnectionId),
        createdAfterBound(createdAfter),
        lt(candidateEvaluations.nextRefreshAt, new Date()),
        or(
          eq(candidateEvaluations.status, 'PASS'),
          eq(candidateEvaluations.status, 'PASS_WITH_ATTENTION'),
          eq(candidateEvaluations.status, 'TEMPORARILY_INELIGIBLE'),
          eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
        ),
      ),
    )
    .limit(limit);

  if (due.length === 0) return [];

  await executor
    .update(candidateEvaluations)
    .set({
      status: 'QUEUED',
      admissionReason: 'EVIDENCE_EXPIRED',
      attemptCount: 0,
      lastErrorCode: null,
      nextRetryAt: null,
      nextRefreshAt: null,
      updatedAt: new Date(),
    })
    .where(
      inArray(
        candidateEvaluations.id,
        due.map((row) => row.id),
      ),
    );

  return due.map((row) => row.candidateId);
}

/**
 * Stranded-work recovery (turnover: "Products cannot remain indefinitely in
 * DISCOVERED, QUEUED, or EVALUATING without a visible due-retry, lease
 * recovery, or terminal failure state"). A row can strand when its
 * EVALUATE_CANDIDATE message is lost or parked by the delivery cap: `QUEUED`
 * with nothing in flight, or `EVALUATING` whose lease expired with no
 * successor. This sweep returns their candidate ids so the caller re-enqueues
 * evaluation messages - state itself needs no change (`QUEUED` is already
 * claimable; expired `EVALUATING` is claimed by the crashed-worker path).
 * Bounded, idempotent: a duplicate message for an already-claimed row no-ops
 * at the claim.
 */
export async function listStrandedEvaluations(
  executor: Executor,
  supplierConnectionId: string,
  input: { stalledSince: Date; limit: number },
): Promise<string[]> {
  const rows = await executor
    .select({ candidateId: candidateEvaluations.candidateId })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .where(
      and(
        eq(supplierCandidates.supplierConnectionId, supplierConnectionId),
        or(
          and(
            eq(candidateEvaluations.status, 'QUEUED'),
            lt(candidateEvaluations.updatedAt, input.stalledSince),
          ),
          and(
            eq(candidateEvaluations.status, 'EVALUATING'),
            lt(candidateEvaluations.leasedUntil, new Date()),
          ),
        ),
      ),
    )
    .limit(input.limit);

  return rows.map((row) => row.candidateId);
}

/**
 * Development-pilot admission: candidates the owner explicitly scoped to a
 * destination, that are currently requeueable, and that have never completed
 * a paid evidence fetch.
 *
 * "Explicitly scoped" is `cardinality(intended_market_codes) > 0`, NOT a
 * country literal. Two reasons: this module is guarded against scattered
 * market literals (see `no-scattered-market-literals.test.ts`), and the
 * meaning that actually matters here is "the owner deliberately recorded a
 * destination for this candidate" - which stays correct if the approved
 * allowlist ever changes.
 *
 * `evidence_summary IS NULL` excludes anything already paid for, so a
 * repeated admission call can never re-spend points on the same product.
 * Bounded and idempotent: the requeue and the queue claim are both no-ops
 * for a row that has already moved.
 */
export async function listPilotAdmissibleCandidates(
  executor: Executor,
  input: { limit: number },
): Promise<string[]> {
  const rows = await executor
    .select({ candidateId: candidateEvaluations.candidateId })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .where(
      and(
        sql`cardinality(${supplierCandidates.intendedMarketCodes}) > 0`,
        isNull(candidateEvaluations.evidenceSummary),
        or(
          eq(candidateEvaluations.status, 'TEMPORARILY_INELIGIBLE'),
          eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
        ),
      ),
    )
    .limit(input.limit);

  return rows.map((row) => row.candidateId);
}

/**
 * Policy-version re-evaluation (ADR-010 §12.6): a new policy/algorithm
 * version queues affected candidates even when the supplier fingerprint did
 * not change - a historical `PASS` or `BLOCKED` row must never stay silently
 * active under an obsolete rule pack. Decided rows whose stored composed
 * `policyVersion` differs from the current one return to `QUEUED` with
 * admission `POLICY_VERSION_CHANGED`, bounded per call. Idempotent: once
 * requeued (or re-decided under the current version) a row no longer
 * matches.
 */
export async function requeuePolicyVersionMismatches(
  executor: Executor,
  supplierConnectionId: string,
  input: {
    currentPolicyVersion: string;
    limit: number;
    /** Freeze line; omit to reach every row, including historical ones. */
    createdAfter?: Date;
  },
): Promise<string[]> {
  const stale = await executor
    .select({
      id: candidateEvaluations.id,
      candidateId: candidateEvaluations.candidateId,
    })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .where(
      and(
        eq(supplierCandidates.supplierConnectionId, supplierConnectionId),
        createdAfterBound(input.createdAfter),
        ne(candidateEvaluations.policyVersion, input.currentPolicyVersion),
        or(
          eq(candidateEvaluations.status, 'PASS'),
          eq(candidateEvaluations.status, 'PASS_WITH_ATTENTION'),
          eq(candidateEvaluations.status, 'BLOCKED'),
          eq(candidateEvaluations.status, 'TEMPORARILY_INELIGIBLE'),
          eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
        ),
      ),
    )
    .limit(input.limit);

  if (stale.length === 0) return [];

  await executor
    .update(candidateEvaluations)
    .set({
      status: 'QUEUED',
      admissionReason: 'POLICY_VERSION_CHANGED',
      attemptCount: 0,
      lastErrorCode: null,
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    .where(
      inArray(
        candidateEvaluations.id,
        stale.map((row) => row.id),
      ),
    );

  return stale.map((row) => row.candidateId);
}

/**
 * How many decided rows are still on an obsolete policy version - the same
 * predicate `requeuePolicyVersionMismatches` selects on, without the bound.
 * Kept beside it so the two can never drift: a bounded requeue is only
 * useful if the caller can see what is left to do.
 */
export async function countPolicyVersionMismatches(
  executor: Executor,
  supplierConnectionId: string,
  input: { currentPolicyVersion: string },
): Promise<number> {
  const [row] = await executor
    .select({ total: sql<number>`count(*)` })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .where(
      and(
        eq(supplierCandidates.supplierConnectionId, supplierConnectionId),
        ne(candidateEvaluations.policyVersion, input.currentPolicyVersion),
        or(
          eq(candidateEvaluations.status, 'PASS'),
          eq(candidateEvaluations.status, 'PASS_WITH_ATTENTION'),
          eq(candidateEvaluations.status, 'BLOCKED'),
          eq(candidateEvaluations.status, 'TEMPORARILY_INELIGIBLE'),
          eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
        ),
      ),
    );

  return Number(row?.total ?? 0);
}

/**
 * Webhook-driven requeue (PRODUCT/VARIANT/STOCK change events): a decided
 * candidate returns to `QUEUED` with admission `MATERIAL_SOURCE_CHANGE`.
 * In-flight rows are left alone (never interrupt work); the change is
 * still observed because the running evaluation fetches fresh evidence.
 * Idempotent: once requeued, a duplicate event matches nothing.
 */
export async function requeueForSourceChange(
  executor: Executor,
  candidateId: string,
): Promise<boolean> {
  const updated = await executor
    .update(candidateEvaluations)
    .set({
      status: 'QUEUED',
      admissionReason: 'MATERIAL_SOURCE_CHANGE',
      attemptCount: 0,
      lastErrorCode: null,
      nextRetryAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(candidateEvaluations.candidateId, candidateId),
        or(
          eq(candidateEvaluations.status, 'PASS'),
          eq(candidateEvaluations.status, 'PASS_WITH_ATTENTION'),
          eq(candidateEvaluations.status, 'BLOCKED'),
          eq(candidateEvaluations.status, 'TEMPORARILY_INELIGIBLE'),
          eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
        ),
      ),
    )
    .returning({ id: candidateEvaluations.id });

  return updated.length > 0;
}

export async function insertIdempotencyRecordIfAbsent(
  executor: Executor,
  record: {
    key: string;
    actorId: string;
    operation: string;
    requestHash: string;
    resultReference: Record<string, unknown>;
    expiresAt: Date;
  },
): Promise<boolean> {
  const inserted = await executor
    .insert(idempotencyRecords)
    .values(record)
    .onConflictDoNothing({ target: idempotencyRecords.key })
    .returning({ id: idempotencyRecords.id });

  return inserted.length > 0;
}
