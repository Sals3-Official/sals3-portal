import { and, eq, inArray, lt, ne, or } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  auditEvents,
  candidateEvaluations,
  idempotencyRecords,
  supplierCandidates,
  supplierSnapshots,
  type CandidateEvaluationRow,
  type IdempotencyRecordRow,
  type SupplierCandidateRow,
  type SupplierSnapshotRow,
} from '@/lib/db/schema';
import type { Decision } from './rules/decide';
import type { EvidenceSummary, FeedSnapshot } from './rules/contracts';
import { MAX_EVALUATION_ATTEMPTS } from './rules/policy';

/**
 * Data access for the candidate shortlist. Every statement is parameterized
 * by Drizzle — no string-built SQL anywhere.
 *
 * Each function accepts an `Executor` so it can run either standalone or
 * inside a transaction, which lets `shortlist.ts` make the whole step atomic
 * without this file knowing about transaction control.
 */

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type Executor = Database | Transaction;

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
    intendedMarketCodes: string[];
    actorId: string;
  },
): Promise<SupplierCandidateRow | null> {
  const inserted = await executor
    .insert(supplierCandidates)
    .values({
      supplier: input.supplier,
      externalProductId: input.externalProductId,
      intendedSellerId: input.intendedSellerId,
      intendedMarketCodes: input.intendedMarketCodes,
      createdBy: input.actorId,
    })
    .onConflictDoNothing({
      target: [
        supplierCandidates.supplier,
        supplierCandidates.externalProductId,
      ],
    })
    .returning();

  return inserted[0] ?? null;
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

export async function findCandidateByExternalId(
  executor: Executor,
  supplier: 'CJ_DROPSHIPPING',
  externalProductId: string,
): Promise<SupplierCandidateRow | null> {
  const rows = await executor
    .select()
    .from(supplierCandidates)
    .where(
      and(
        eq(supplierCandidates.supplier, supplier),
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
    .set({ status: 'QUEUED', updatedAt: new Date() })
    .where(
      inArray(
        candidateEvaluations.id,
        due.map((row) => row.id),
      ),
    );

  return due.length;
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
  tx: Transaction,
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

/** Persists a completed decision (PASS / PASS_WITH_ATTENTION / BLOCKED / TEMPORARILY_INELIGIBLE). */
export async function recordEvaluationDecision(
  executor: Executor,
  input: {
    candidateId: string;
    decision: Decision;
    evidenceSummary: EvidenceSummary;
    sourceSnapshotChecksum: string;
    policyVersion: string;
    lastKnownPriceUsdCents: number | null;
  },
): Promise<void> {
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
      attemptCount: 0,
      lastErrorCode: null,
      nextRetryAt: null,
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
      leasedBy: null,
      leasedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(candidateEvaluations.candidateId, input.candidateId));
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
