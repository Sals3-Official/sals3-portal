import { and, eq } from 'drizzle-orm';
import type { Database } from '@/lib/db/client';
import {
  auditEvents,
  idempotencyRecords,
  supplierCandidates,
  supplierSnapshots,
  type IdempotencyRecordRow,
  type SupplierCandidateRow,
  type SupplierSnapshotRow,
} from '@/lib/db/schema';

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
