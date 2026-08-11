import {
  and,
  asc,
  countDistinct,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { Database, DbExecutor } from '@/lib/db/client';
import {
  discoveryPartitions,
  discoveryReconcilePids,
  type DiscoveryPartitionRow,
  type NewDiscoveryPartitionRow,
} from '@/lib/db/schema';
import { MAX_PARTITION_ATTEMPTS, PARTITION_LEASE_MS } from './config';
import type { PartitionBounds } from './partition-plan';

/**
 * Partition persistence with exact leases and compare-and-swap transitions.
 * Every important transition matches state, stateVersion, lease token, and a
 * non-null unexpired lease in its WHERE clause - a stale worker whose lease
 * was reclaimed can never regress, double-count, or falsely complete a
 * partition, whatever order at-least-once deliveries arrive in.
 */

export function boundsOf(row: DiscoveryPartitionRow): PartitionBounds {
  return {
    categoryId: row.categoryId,
    timeFromMs: row.createTimeFromMs,
    timeToMs: row.createTimeToMs,
    priceFromCents: row.priceFromCents,
    priceToCents: row.priceToCents,
  };
}

export async function insertPartitions(
  executor: DbExecutor,
  rows: NewDiscoveryPartitionRow[],
): Promise<DiscoveryPartitionRow[]> {
  if (rows.length === 0) return [];

  return executor.insert(discoveryPartitions).values(rows).returning();
}

export async function findPartitionById(
  executor: DbExecutor,
  partitionId: string,
): Promise<DiscoveryPartitionRow | null> {
  const rows = await executor
    .select()
    .from(discoveryPartitions)
    .where(eq(discoveryPartitions.id, partitionId))
    .limit(1);

  return rows[0] ?? null;
}

export type PartitionLease = {
  row: DiscoveryPartitionRow;
  leaseToken: string;
};

/**
 * Leases one workable partition (PENDING or RECONCILING, lease free or
 * expired) for exactly one worker. Attempts increment at claim time so a
 * crashed worker still consumes its bounded attempt budget. Returns null
 * when the partition is terminal, currently leased, or out of attempts -
 * the caller must then leave it alone (an exhausted partition is marked
 * FAILED by `failPartitionIfExhausted`, never silently retried forever).
 */
export async function leasePartition(
  db: Database,
  input: { partitionId: string; leaseToken: string },
): Promise<PartitionLease | null> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const rows = await tx
      .select()
      .from(discoveryPartitions)
      .where(eq(discoveryPartitions.id, input.partitionId))
      .limit(1)
      .for('update');

    const row = rows[0];

    if (row === undefined) return null;
    if (row.state !== 'PENDING' && row.state !== 'RECONCILING') return null;
    if (row.leasedUntil !== null && row.leasedUntil > now) return null;
    if (row.attempts >= MAX_PARTITION_ATTEMPTS) return null;

    const leased = await tx
      .update(discoveryPartitions)
      .set({
        leaseToken: input.leaseToken,
        leasedUntil: new Date(now.getTime() + PARTITION_LEASE_MS),
        attempts: row.attempts + 1,
        updatedAt: now,
      })
      .where(
        and(
          eq(discoveryPartitions.id, row.id),
          eq(discoveryPartitions.stateVersion, row.stateVersion),
        ),
      )
      .returning();

    if (leased[0] === undefined) return null;

    return { row: leased[0], leaseToken: input.leaseToken };
  });
}

/**
 * Leases an attempts-exhausted, unleased partition purely so the caller can
 * transition it to the visible FAILED state - the ONE path allowed past the
 * attempt cap, because its only possible outcome is the terminal state.
 * Exhaustion must surface operationally, never strand a partition in
 * PENDING/RECONCILING forever.
 */
export async function leaseExhaustedPartition(
  db: Database,
  input: { partitionId: string; leaseToken: string },
): Promise<PartitionLease | null> {
  return db.transaction(async (tx) => {
    const now = new Date();
    const rows = await tx
      .select()
      .from(discoveryPartitions)
      .where(eq(discoveryPartitions.id, input.partitionId))
      .limit(1)
      .for('update');

    const row = rows[0];

    if (row === undefined) return null;
    if (row.state !== 'PENDING' && row.state !== 'RECONCILING') return null;
    if (row.leasedUntil !== null && row.leasedUntil > now) return null;
    if (row.attempts < MAX_PARTITION_ATTEMPTS) return null;

    const leased = await tx
      .update(discoveryPartitions)
      .set({
        leaseToken: input.leaseToken,
        leasedUntil: new Date(now.getTime() + PARTITION_LEASE_MS),
        updatedAt: now,
      })
      .where(
        and(
          eq(discoveryPartitions.id, row.id),
          eq(discoveryPartitions.stateVersion, row.stateVersion),
        ),
      )
      .returning();

    if (leased[0] === undefined) return null;

    return { row: leased[0], leaseToken: input.leaseToken };
  });
}

/** The exact-lease predicate shared by every guarded transition below. */
function heldLease(partitionId: string, leaseToken: string) {
  return and(
    eq(discoveryPartitions.id, partitionId),
    eq(discoveryPartitions.leaseToken, leaseToken),
    sql`${discoveryPartitions.leasedUntil} > now()`,
  );
}

/**
 * Releases a lease after a transient failure WITHOUT advancing anything.
 * The durable cursor/state never moves on a failure path.
 */
export async function releasePartitionLease(
  executor: DbExecutor,
  input: {
    partitionId: string;
    leaseToken: string;
    errorCode: string;
    consumeAttempt?: boolean;
  },
): Promise<void> {
  await executor
    .update(discoveryPartitions)
    .set({
      attempts:
        input.consumeAttempt === false
          ? sql`greatest(${discoveryPartitions.attempts} - 1, 0)`
          : undefined,
      leaseToken: null,
      leasedUntil: null,
      lastErrorCode: input.errorCode,
      updatedAt: new Date(),
    })
    .where(heldLease(input.partitionId, input.leaseToken));
}

/**
 * Marks a partition FAILED once its bounded attempts are exhausted - a
 * visible operational state that blocks cycle completion, never a silent
 * drop. CAS on the exact lease.
 */
export async function failPartition(
  executor: DbExecutor,
  input: { partitionId: string; leaseToken: string; errorCode: string },
): Promise<boolean> {
  const updated = await executor
    .update(discoveryPartitions)
    .set({
      state: 'FAILED',
      lastErrorCode: input.errorCode,
      leaseToken: null,
      leasedUntil: null,
      stateVersion: sql`${discoveryPartitions.stateVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(heldLease(input.partitionId, input.leaseToken))
    .returning({ id: discoveryPartitions.id });

  return updated.length > 0;
}

/** COVERED with proof fields. CAS on the exact lease. */
export async function coverPartition(
  executor: DbExecutor,
  input: {
    partitionId: string;
    leaseToken: string;
    reportedTotal: number;
    uniquePidCount: number;
    passChecksums: string[];
  },
): Promise<boolean> {
  const updated = await executor
    .update(discoveryPartitions)
    .set({
      state: 'COVERED',
      reportedTotal: input.reportedTotal,
      uniquePidCount: input.uniquePidCount,
      passChecksums: input.passChecksums,
      coveredAt: new Date(),
      lastErrorCode: null,
      leaseToken: null,
      leasedUntil: null,
      stateVersion: sql`${discoveryPartitions.stateVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(heldLease(input.partitionId, input.leaseToken))
    .returning({ id: discoveryPartitions.id });

  return updated.length > 0;
}

/** SPLIT: this node's coverage obligation moves to its children. CAS on the lease. */
export async function splitPartition(
  executor: DbExecutor,
  input: { partitionId: string; leaseToken: string; reportedTotal: number },
): Promise<boolean> {
  const updated = await executor
    .update(discoveryPartitions)
    .set({
      state: 'SPLIT',
      reportedTotal: input.reportedTotal,
      lastErrorCode: null,
      leaseToken: null,
      leasedUntil: null,
      stateVersion: sql`${discoveryPartitions.stateVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(heldLease(input.partitionId, input.leaseToken))
    .returning({ id: discoveryPartitions.id });

  return updated.length > 0;
}

/**
 * Transition into (or advance within) atomic reconciliation. The pass/page
 * cursor only ever moves through this exact-lease CAS, so a duplicate or
 * out-of-order delivery can re-fetch a page (harmless - the PID accumulator
 * deduplicates) but can never advance the cursor twice.
 */
export async function advanceReconciliation(
  executor: DbExecutor,
  input: {
    partitionId: string;
    leaseToken: string;
    reconcilePass: number;
    reconcileNextPage: number;
    reportedTotal: number;
    releaseLease: boolean;
  },
): Promise<boolean> {
  const updated = await executor
    .update(discoveryPartitions)
    .set({
      state: 'RECONCILING',
      reconcilePass: input.reconcilePass,
      reconcileNextPage: input.reconcileNextPage,
      reportedTotal: input.reportedTotal,
      lastErrorCode: null,
      ...(input.releaseLease ? { leaseToken: null, leasedUntil: null } : {}),
      updatedAt: new Date(),
    })
    .where(heldLease(input.partitionId, input.leaseToken))
    .returning({ id: discoveryPartitions.id });

  return updated.length > 0;
}

/** Appends a completed pass checksum and resets the page cursor for the next pass. */
export async function completeReconcilePass(
  executor: DbExecutor,
  input: {
    partitionId: string;
    leaseToken: string;
    checksum: string;
    nextPass: number;
  },
): Promise<boolean> {
  const updated = await executor
    .update(discoveryPartitions)
    .set({
      passChecksums: sql`array_append(${discoveryPartitions.passChecksums}, ${input.checksum})`,
      reconcilePass: input.nextPass,
      reconcileNextPage: 1,
      reconcileAttempts: sql`${discoveryPartitions.reconcileAttempts} + 1`,
      updatedAt: new Date(),
    })
    .where(heldLease(input.partitionId, input.leaseToken))
    .returning({ id: discoveryPartitions.id });

  return updated.length > 0;
}

/** PROVIDER_COVERAGE_UNRESOLVED - visibly unresolved; blocks cycle COMPLETE. */
export async function markPartitionUnresolved(
  executor: DbExecutor,
  input: {
    partitionId: string;
    leaseToken: string;
    unresolvedReason: string;
    reportedTotal: number | null;
  },
): Promise<boolean> {
  const updated = await executor
    .update(discoveryPartitions)
    .set({
      state: 'PROVIDER_COVERAGE_UNRESOLVED',
      unresolvedReason: input.unresolvedReason,
      reportedTotal: input.reportedTotal,
      leaseToken: null,
      leasedUntil: null,
      stateVersion: sql`${discoveryPartitions.stateVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(heldLease(input.partitionId, input.leaseToken))
    .returning({ id: discoveryPartitions.id });

  return updated.length > 0;
}

// --- Reconciliation PID accumulator ------------------------------------------

export async function insertReconcilePids(
  executor: DbExecutor,
  input: { partitionId: string; pass: number; pids: string[] },
): Promise<void> {
  if (input.pids.length === 0) return;

  await executor
    .insert(discoveryReconcilePids)
    .values(
      input.pids.map((pid) => ({
        partitionId: input.partitionId,
        pass: input.pass,
        pid,
      })),
    )
    .onConflictDoNothing();
}

export async function countReconcilePids(
  executor: DbExecutor,
  input: { partitionId: string; pass: number },
): Promise<number> {
  const rows = await executor
    .select({ total: countDistinct(discoveryReconcilePids.pid) })
    .from(discoveryReconcilePids)
    .where(
      and(
        eq(discoveryReconcilePids.partitionId, input.partitionId),
        eq(discoveryReconcilePids.pass, input.pass),
      ),
    );

  return Number(rows[0]?.total ?? 0);
}

/** Sorted unique PIDs of one pass - the checksum input. */
export async function listReconcilePids(
  executor: DbExecutor,
  input: { partitionId: string; pass: number },
): Promise<string[]> {
  const rows = await executor
    .select({ pid: discoveryReconcilePids.pid })
    .from(discoveryReconcilePids)
    .where(
      and(
        eq(discoveryReconcilePids.partitionId, input.partitionId),
        eq(discoveryReconcilePids.pass, input.pass),
      ),
    )
    .orderBy(asc(discoveryReconcilePids.pid));

  return rows.map((row) => row.pid);
}

/** Frees accumulator storage once the partition reached a terminal state. */
export async function clearReconcilePids(
  executor: DbExecutor,
  partitionId: string,
): Promise<void> {
  await executor
    .delete(discoveryReconcilePids)
    .where(eq(discoveryReconcilePids.partitionId, partitionId));
}

// --- Sweep / status reads ------------------------------------------------------

/**
 * Non-terminal partitions with no live lease - what a sweep re-enqueues so
 * lost queue messages or expired leases can never permanently stall a cycle.
 */
export async function listResumablePartitions(
  executor: DbExecutor,
  input: { cycleId: string; limit: number },
): Promise<DiscoveryPartitionRow[]> {
  return executor
    .select()
    .from(discoveryPartitions)
    .where(
      and(
        eq(discoveryPartitions.cycleId, input.cycleId),
        inArray(discoveryPartitions.state, ['PENDING', 'RECONCILING']),
        or(
          isNull(discoveryPartitions.leasedUntil),
          lte(discoveryPartitions.leasedUntil, new Date()),
        ),
      ),
    )
    .orderBy(asc(discoveryPartitions.createdAt))
    .limit(input.limit);
}

export async function countPartitionsByState(
  executor: DbExecutor,
  cycleId: string,
): Promise<Record<string, number>> {
  const rows = await executor
    .select({
      state: discoveryPartitions.state,
      total: sql<number>`count(*)`,
    })
    .from(discoveryPartitions)
    .where(eq(discoveryPartitions.cycleId, cycleId))
    .groupBy(discoveryPartitions.state);

  return Object.fromEntries(rows.map((row) => [row.state, Number(row.total)]));
}

/** Unresolved/failed partitions with reasons, for operational status. */
export async function listBlockedPartitions(
  executor: DbExecutor,
  input: { cycleId: string; limit: number },
): Promise<DiscoveryPartitionRow[]> {
  return executor
    .select()
    .from(discoveryPartitions)
    .where(
      and(
        eq(discoveryPartitions.cycleId, input.cycleId),
        inArray(discoveryPartitions.state, [
          'PROVIDER_COVERAGE_UNRESOLVED',
          'FAILED',
        ]),
      ),
    )
    .orderBy(asc(discoveryPartitions.updatedAt))
    .limit(input.limit);
}
