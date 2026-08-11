import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import { discoveryCycles, type DiscoveryCycleRow } from '@/lib/db/schema';
import type { SupplierCategoryLeaf } from '@/modules/suppliers/contracts';
import { generationKey } from './lane-repository';

/**
 * Discovery cycle persistence. A cycle's `cycleCutoff` and category snapshot
 * are immutable after creation (ADR-013 §3: never mutate the identity/root
 * set of an active cycle); progression happens only through counters and the
 * guarded state machine below. The database's partial unique index -
 * one non-terminal cycle per connection - is what makes "two active chains"
 * impossible, not application politeness.
 */

const ACTIVE_STATES = ['SEEDING', 'RUNNING'] as const;

export async function findActiveCycle(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<DiscoveryCycleRow | null> {
  const rows = await executor
    .select()
    .from(discoveryCycles)
    .where(
      and(
        eq(discoveryCycles.supplierConnectionId, supplierConnectionId),
        inArray(discoveryCycles.state, [...ACTIVE_STATES]),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function findCycleById(
  executor: DbExecutor,
  cycleId: string,
): Promise<DiscoveryCycleRow | null> {
  const rows = await executor
    .select()
    .from(discoveryCycles)
    .where(eq(discoveryCycles.id, cycleId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Creates the next cycle unless an active one already exists. Returns the
 * active cycle either way. Two concurrent calls cannot create two cycles:
 * the partial unique index rejects the loser, which then re-reads.
 */
export async function createCycleIfAbsent(
  executor: DbExecutor,
  input: {
    supplierConnectionId: string;
    cycleCutoff: Date;
    lane?: 'BOOTSTRAP' | 'INCREMENTAL' | 'AUDIT';
    windowFrom?: Date | null;
    safetyOverlapSeconds?: number | null;
  },
): Promise<{ cycle: DiscoveryCycleRow; created: boolean }> {
  const existing = await findActiveCycle(executor, input.supplierConnectionId);

  if (existing !== null) return { cycle: existing, created: false };

  const inserted = await executor
    .insert(discoveryCycles)
    .values({
      supplierConnectionId: input.supplierConnectionId,
      cycleCutoff: input.cycleCutoff,
      lane: input.lane ?? 'BOOTSTRAP',
      generationKey: generationKey(),
      windowFrom: input.windowFrom ?? null,
      safetyOverlapSeconds: input.safetyOverlapSeconds ?? null,
      state: 'SEEDING',
    })
    // No conflict target: the guarding constraint is the partial unique
    // index on (connection) WHERE state IN ('SEEDING','RUNNING'), which a
    // column-target form cannot express.
    .onConflictDoNothing()
    .returning();

  if (inserted[0] !== undefined) return { cycle: inserted[0], created: true };

  const raced = await findActiveCycle(executor, input.supplierConnectionId);

  if (raced === null) {
    throw new Error('Cycle conflicted on insert but could not be read back.');
  }

  return { cycle: raced, created: false };
}

export async function findLatestCompletedCycle(
  executor: DbExecutor,
  input: {
    supplierConnectionId: string;
    lane: 'BOOTSTRAP' | 'INCREMENTAL' | 'AUDIT';
  },
): Promise<DiscoveryCycleRow | null> {
  const rows = await executor
    .select()
    .from(discoveryCycles)
    .where(
      and(
        eq(discoveryCycles.supplierConnectionId, input.supplierConnectionId),
        eq(discoveryCycles.lane, input.lane),
        eq(discoveryCycles.state, 'COMPLETE'),
      ),
    )
    .orderBy(sql`${discoveryCycles.completedAt} DESC NULLS LAST`)
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Persists the category snapshot exactly once (CAS on a still-null
 * snapshot), so a duplicate DISCOVERY_CYCLE_START delivery can never
 * replace the root set an active cycle is already seeding from.
 */
export async function recordCategorySnapshotIfAbsent(
  executor: DbExecutor,
  input: { cycleId: string; leaves: SupplierCategoryLeaf[] },
): Promise<boolean> {
  const updated = await executor
    .update(discoveryCycles)
    .set({ categorySnapshot: input.leaves, updatedAt: new Date() })
    .where(
      and(
        eq(discoveryCycles.id, input.cycleId),
        sql`${discoveryCycles.categorySnapshot} IS NULL`,
      ),
    )
    .returning({ id: discoveryCycles.id });

  return updated.length > 0;
}

/**
 * Advances the bounded seeding cursor after a batch of root partitions was
 * persisted. CAS on the exact previous cursor: a duplicate delivery that
 * lost the race sees zero updated rows and does nothing.
 */
export async function advanceSeedCursor(
  executor: DbExecutor,
  input: {
    cycleId: string;
    fromCursor: number;
    toCursor: number;
    partitionsAdded: number;
  },
): Promise<boolean> {
  const updated = await executor
    .update(discoveryCycles)
    .set({
      seedCursor: input.toCursor,
      partitionsTotal: sql`${discoveryCycles.partitionsTotal} + ${input.partitionsAdded}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(discoveryCycles.id, input.cycleId),
        eq(discoveryCycles.seedCursor, input.fromCursor),
        eq(discoveryCycles.state, 'SEEDING'),
      ),
    )
    .returning({ id: discoveryCycles.id });

  return updated.length > 0;
}

/** Seeding finished: cursor -1, state RUNNING. CAS on SEEDING. */
export async function markSeedingComplete(
  executor: DbExecutor,
  cycleId: string,
): Promise<boolean> {
  const updated = await executor
    .update(discoveryCycles)
    .set({ seedCursor: -1, state: 'RUNNING', updatedAt: new Date() })
    .where(
      and(
        eq(discoveryCycles.id, cycleId),
        eq(discoveryCycles.state, 'SEEDING'),
      ),
    )
    .returning({ id: discoveryCycles.id });

  return updated.length > 0;
}

/**
 * Split bookkeeping: a SPLIT partition is terminal for its node, and its
 * children join the total, all in the caller's transaction.
 */
export async function recordPartitionSplit(
  executor: DbExecutor,
  input: { cycleId: string; childrenAdded: number },
): Promise<void> {
  await executor
    .update(discoveryCycles)
    .set({
      partitionsTotal: sql`${discoveryCycles.partitionsTotal} + ${input.childrenAdded}`,
      partitionsTerminal: sql`${discoveryCycles.partitionsTerminal} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(discoveryCycles.id, input.cycleId));
}

/** COVERED / UNRESOLVED / FAILED bookkeeping in the caller's transaction. */
export async function recordPartitionTerminal(
  executor: DbExecutor,
  input: { cycleId: string; unresolved: boolean },
): Promise<void> {
  await executor
    .update(discoveryCycles)
    .set({
      partitionsTerminal: sql`${discoveryCycles.partitionsTerminal} + 1`,
      ...(input.unresolved
        ? {
            partitionsUnresolved: sql`${discoveryCycles.partitionsUnresolved} + 1`,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(eq(discoveryCycles.id, input.cycleId));
}

export type CycleCompletionOutcome =
  'STILL_RUNNING' | 'COMPLETE' | 'COVERAGE_UNRESOLVED';

/**
 * Attempts to close a cycle. A cycle becomes COMPLETE only when seeding is
 * finished AND every partition is terminal AND none is unresolved or
 * failed - the caller passes the live blocked-state count so FAILED
 * partitions also block completion (turnover: a cycle cannot become
 * COMPLETE while any descendant is queued, leased, retryable, failed, or
 * unresolved). With any unresolved/failed descendant the terminal state is
 * COVERAGE_UNRESOLVED - visibly incomplete, never silently promoted.
 */
export async function tryFinishCycle(
  executor: DbExecutor,
  input: { cycleId: string; blockedPartitions: number },
): Promise<CycleCompletionOutcome> {
  const rows = await executor
    .select()
    .from(discoveryCycles)
    .where(eq(discoveryCycles.id, input.cycleId))
    .limit(1);

  const cycle = rows[0];

  if (
    cycle === undefined ||
    cycle.state !== 'RUNNING' ||
    cycle.seedCursor !== -1 ||
    cycle.partitionsTerminal < cycle.partitionsTotal
  ) {
    return 'STILL_RUNNING';
  }

  const unresolved =
    cycle.partitionsUnresolved > 0 || input.blockedPartitions > 0;
  const finalState = unresolved ? 'COVERAGE_UNRESOLVED' : 'COMPLETE';

  const updated = await executor
    .update(discoveryCycles)
    .set({
      state: finalState,
      completedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(discoveryCycles.id, input.cycleId),
        eq(discoveryCycles.state, 'RUNNING'),
        eq(discoveryCycles.partitionsTerminal, cycle.partitionsTerminal),
      ),
    )
    .returning({ id: discoveryCycles.id });

  if (updated.length === 0) return 'STILL_RUNNING';

  return finalState;
}

/** Queue-chain heartbeat (ADR-010 §12.11), separate from HTTP health. */
export async function heartbeatCycle(
  executor: DbExecutor,
  cycleId: string,
): Promise<void> {
  await executor
    .update(discoveryCycles)
    .set({ lastHeartbeatAt: new Date(), updatedAt: new Date() })
    .where(eq(discoveryCycles.id, cycleId));
}
