import getDb from '@/lib/db/client';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import CjSupplierAdapter from '@/modules/suppliers/providers/cj/cj-adapter';
import {
  findConnectionById,
  isWorkableConnectionStatus,
} from '@/modules/suppliers/repository';
import type { SupplierCategoryLeaf } from '@/modules/suppliers/contracts';
import {
  CYCLE_SWEEP_DELAY_SECONDS,
  discoveryEpochMs,
  FRESHNESS_SWEEP_DELAY_SECONDS,
  INCREMENTAL_SAFETY_OVERLAP_SECONDS,
  NEXT_CYCLE_DELAY_SECONDS,
  SEED_BATCH_SIZE,
} from './config';
import type { DiscoveryCycleStartMessage } from './messages';
import { ensureBudgetRow, tryAcquireRequestSlot } from './budget-repository';
import {
  advanceSeedCursor,
  createCycleIfAbsent,
  findActiveCycle,
  findLatestCompletedCycle,
  heartbeatCycle,
  markSeedingComplete,
  recordCategorySnapshotIfAbsent,
} from './cycle-repository';
import {
  insertPartitions,
  listResumablePartitions,
} from './partition-repository';
import { insertOutboxIntents, type OutboxIntent } from './outbox-repository';
import { recordDiscoveryFailure } from './failure-repository';
import { isDiscoveryRunning } from './run-state-repository';
import { findWatermark } from './lane-repository';

/**
 * DISCOVERY_CYCLE_START: the ensure-and-sweep operation for one connection's
 * durable discovery chain. Idempotent and safe under duplicate/out-of-order
 * delivery - every step is guarded by database state:
 *
 * 1. Ensure the active cycle exists (partial unique index = never two).
 * 2. Capture the category tree snapshot exactly once per cycle.
 * 3. Seed leaf-category root partitions in bounded batches (CAS cursor),
 *    re-enqueueing itself until seeding completes.
 * 4. Once RUNNING, sweep: re-enqueue unleased non-terminal partitions so a
 *    lost message or expired lease can never permanently stall coverage,
 *    then re-enqueue itself as the delayed self-healing continuation.
 *
 * This continuation IS the chain's heartbeat - queue-delayed, never a cron.
 */

function sweepWindowKey(): number {
  return Math.floor(Date.now() / (CYCLE_SWEEP_DELAY_SECONDS * 1000));
}

export function partitionMessageIntent(input: {
  supplierConnectionId: string;
  cycleId: string;
  partitionId: string;
  keySuffix: string;
  delaySeconds?: number;
}): OutboxIntent {
  return {
    message: {
      v: 1,
      operation: 'DISCOVERY_PARTITION',
      idempotencyKey: `partition:${input.partitionId}:${input.keySuffix}`,
      supplierConnectionId: input.supplierConnectionId,
      cycleId: input.cycleId,
      partitionId: input.partitionId,
    },
    delaySeconds: input.delaySeconds,
  };
}

export function cycleStartIntent(input: {
  supplierConnectionId: string;
  cycleId?: string;
  lane?: DiscoveryLane;
  keySuffix: string;
  delaySeconds?: number;
}): OutboxIntent {
  return {
    message: {
      v: 1,
      operation: 'DISCOVERY_CYCLE_START',
      idempotencyKey: `cycle-start:${input.supplierConnectionId}:${input.keySuffix}`,
      supplierConnectionId: input.supplierConnectionId,
      ...(input.lane === undefined ? {} : { lane: input.lane }),
      ...(input.cycleId === undefined ? {} : { cycleId: input.cycleId }),
    },
    delaySeconds: input.delaySeconds,
  };
}

/** Root partitions for one leaf category: the pre-epoch sentinel plus the epoch-to-cutoff range. */
type DiscoveryLane = 'BOOTSTRAP' | 'INCREMENTAL' | 'AUDIT';

function rootPartitionsForLeaf(
  leaf: SupplierCategoryLeaf,
  input: {
    cycleId: string;
    supplierConnectionId: string;
    cutoffMs: number;
    lane: DiscoveryLane;
    windowFromMs: number | null;
  },
): Array<{
  cycleId: string;
  supplierConnectionId: string;
  categoryId: string;
  createTimeFromMs: number | null;
  createTimeToMs: number;
}> {
  const epochMs = discoveryEpochMs();
  const base = {
    cycleId: input.cycleId,
    supplierConnectionId: input.supplierConnectionId,
    categoryId: leaf.categoryId,
  };

  if (input.lane === 'INCREMENTAL') {
    return [
      {
        ...base,
        createTimeFromMs: input.windowFromMs,
        createTimeToMs: input.cutoffMs,
      },
    ];
  }

  if (epochMs >= input.cutoffMs) {
    // Degenerate configuration (epoch at/after cutoff): one open-start root
    // still covers everything at or before the cutoff.
    return [
      { ...base, createTimeFromMs: null, createTimeToMs: input.cutoffMs },
    ];
  }

  return [
    // Sentinel: products created before the configured epoch. Open start -
    // dense sentinels go straight to atomic reconciliation, never guessed
    // time splits.
    { ...base, createTimeFromMs: null, createTimeToMs: epochMs },
    { ...base, createTimeFromMs: epochMs, createTimeToMs: input.cutoffMs },
  ];
}

const categoryLeavesSchema = (value: unknown): SupplierCategoryLeaf[] =>
  Array.isArray(value) ? (value as SupplierCategoryLeaf[]) : [];

async function resolveNextLane(
  supplierConnectionId: string,
  requested?: DiscoveryLane,
): Promise<{
  lane: DiscoveryLane;
  windowFrom: Date | null;
  safetyOverlapSeconds: number | null;
  delaySeconds?: number;
}> {
  if (requested === 'AUDIT') {
    return { lane: 'AUDIT', windowFrom: null, safetyOverlapSeconds: null };
  }

  const db = getDb();
  const bootstrap = await findLatestCompletedCycle(db, {
    supplierConnectionId,
    lane: 'BOOTSTRAP',
  });

  if (bootstrap === null && requested !== 'INCREMENTAL') {
    return { lane: 'BOOTSTRAP', windowFrom: null, safetyOverlapSeconds: null };
  }

  const watermark = await findWatermark(db, supplierConnectionId);
  const baseFrom =
    watermark?.nextWindowFrom ??
    watermark?.provenCutoff ??
    bootstrap?.cycleCutoff;

  if (baseFrom === undefined || baseFrom === null) {
    return { lane: 'BOOTSTRAP', windowFrom: null, safetyOverlapSeconds: null };
  }

  const windowFrom = new Date(
    baseFrom.getTime() - INCREMENTAL_SAFETY_OVERLAP_SECONDS * 1000,
  );

  return {
    lane: 'INCREMENTAL',
    windowFrom,
    safetyOverlapSeconds: INCREMENTAL_SAFETY_OVERLAP_SECONDS,
    delaySeconds:
      requested === 'INCREMENTAL' ? undefined : NEXT_CYCLE_DELAY_SECONDS,
  };
}

export default async function handleCycleStart(
  message: DiscoveryCycleStartMessage,
): Promise<void> {
  const db = getDb();
  const connection = await findConnectionById(db, message.supplierConnectionId);

  if (connection === null || !isWorkableConnectionStatus(connection.status)) {
    // Connection loss is connection health, not a discovery failure; the
    // reconnect path restarts the chain. Acknowledge and park.
    return;
  }

  if (!(await isDiscoveryRunning(db, connection.id))) {
    // Paused: retain all checkpoints/state, do no new supplier work.
    // Resume re-enqueues this operation.
    return;
  }

  await ensureBudgetRow(db, connection.id);

  const lanePlan = await resolveNextLane(connection.id, message.lane);
  const { cycle } = await createCycleIfAbsent(db, {
    supplierConnectionId: connection.id,
    cycleCutoff: new Date(),
    lane: lanePlan.lane,
    windowFrom: lanePlan.windowFrom,
    safetyOverlapSeconds: lanePlan.safetyOverlapSeconds,
  });

  await heartbeatCycle(db, cycle.id);

  // --- Category snapshot (once per cycle) --------------------------------
  if (cycle.categorySnapshot === null) {
    if (!(await tryAcquireRequestSlot(db, connection.id))) {
      // Rate slot unavailable right now - delayed continuation, no spin.
      await insertOutboxIntents(db, [
        cycleStartIntent({
          supplierConnectionId: connection.id,
          cycleId: cycle.id,
          keySuffix: `snapshot-retry:${cycle.id}:${sweepWindowKey()}`,
          delaySeconds: 30,
        }),
      ]);
      return;
    }

    const secretStore = new PostgresSupplierSecretStore();
    const adapter = new CjSupplierAdapter(
      secretStore,
      new CjTokenManager(secretStore),
    );

    let leaves: SupplierCategoryLeaf[];

    try {
      leaves = await adapter.getCategoryTree(connection.id);
    } catch {
      await recordDiscoveryFailure(db, {
        scope: 'DISCOVERY_CYCLE_START',
        referenceId: cycle.id,
        errorCode: 'CATEGORY_TREE_FETCH_FAILED',
      });
      await insertOutboxIntents(db, [
        cycleStartIntent({
          supplierConnectionId: connection.id,
          cycleId: cycle.id,
          keySuffix: `snapshot-retry:${cycle.id}:${sweepWindowKey()}`,
          delaySeconds: 300,
        }),
      ]);
      return;
    }

    if (leaves.length === 0) {
      // An empty tree would seed zero partitions and instantly "complete"
      // the cycle - refuse it as a contract anomaly instead.
      await recordDiscoveryFailure(db, {
        scope: 'DISCOVERY_CYCLE_START',
        referenceId: cycle.id,
        errorCode: 'CATEGORY_TREE_EMPTY',
      });
      await insertOutboxIntents(db, [
        cycleStartIntent({
          supplierConnectionId: connection.id,
          cycleId: cycle.id,
          keySuffix: `snapshot-retry:${cycle.id}:${sweepWindowKey()}`,
          delaySeconds: 3_600,
        }),
      ]);
      return;
    }

    await recordCategorySnapshotIfAbsent(db, { cycleId: cycle.id, leaves });
    // Re-enter immediately to begin seeding against the persisted snapshot.
    await insertOutboxIntents(db, [
      cycleStartIntent({
        supplierConnectionId: connection.id,
        cycleId: cycle.id,
        keySuffix: `seed:${cycle.id}:0`,
      }),
    ]);
    return;
  }

  // --- Bounded seeding --------------------------------------------------
  if (cycle.state === 'SEEDING' && cycle.seedCursor >= 0) {
    const leaves = categoryLeavesSchema(cycle.categorySnapshot);
    const from = cycle.seedCursor;
    const batch = leaves.slice(from, from + SEED_BATCH_SIZE);

    if (batch.length === 0) {
      await markSeedingComplete(db, cycle.id);
    } else {
      const cutoffMs = cycle.cycleCutoff.getTime();
      const windowFromMs = cycle.windowFrom?.getTime() ?? null;

      await db
        .transaction(async (tx) => {
          const rows = batch.flatMap((leaf) =>
            rootPartitionsForLeaf(leaf, {
              cycleId: cycle.id,
              supplierConnectionId: connection.id,
              cutoffMs,
              lane: cycle.lane,
              windowFromMs,
            }),
          );
          const inserted = await insertPartitions(tx, rows);
          const advanced = await advanceSeedCursor(tx, {
            cycleId: cycle.id,
            fromCursor: from,
            toCursor: from + batch.length,
            partitionsAdded: inserted.length,
          });

          if (!advanced) {
            // A concurrent duplicate delivery already seeded this batch;
            // rolling back keeps the partition set exactly-once.
            throw new Error('SEED_CURSOR_CONFLICT');
          }

          await insertOutboxIntents(
            tx,
            inserted.map((partition) =>
              partitionMessageIntent({
                supplierConnectionId: connection.id,
                cycleId: cycle.id,
                partitionId: partition.id,
                keySuffix: 'initial',
              }),
            ),
          );
        })
        .catch((error: unknown) => {
          if (
            !(error instanceof Error) ||
            error.message !== 'SEED_CURSOR_CONFLICT'
          ) {
            throw error;
          }
        });
    }

    // Continue seeding (or fall through to RUNNING on the next delivery).
    await insertOutboxIntents(db, [
      cycleStartIntent({
        supplierConnectionId: connection.id,
        cycleId: cycle.id,
        keySuffix: `seed:${cycle.id}:${from + batch.length}`,
      }),
    ]);
    return;
  }

  // --- Sweep + self-healing continuation ---------------------------------
  const active = await findActiveCycle(db, connection.id);

  if (active === null) {
    // The cycle finished between claims; the completion path already
    // enqueued the next cycle. Nothing to sweep.
    return;
  }

  const resumable = await listResumablePartitions(db, {
    cycleId: active.id,
    limit: SEED_BATCH_SIZE,
  });

  await insertOutboxIntents(db, [
    ...resumable.map((partition) =>
      partitionMessageIntent({
        supplierConnectionId: connection.id,
        cycleId: active.id,
        partitionId: partition.id,
        keySuffix: `sweep:${sweepWindowKey()}`,
      }),
    ),
    cycleStartIntent({
      supplierConnectionId: connection.id,
      cycleId: active.id,
      keySuffix: `sweep:${sweepWindowKey() + 1}`,
      delaySeconds: CYCLE_SWEEP_DELAY_SECONDS,
    }),
    // Keep the freshness sweep chain alive alongside discovery.
    {
      message: {
        v: 1,
        operation: 'RECONCILE_PRODUCT',
        idempotencyKey: `freshness:${connection.id}:${Math.floor(
          Date.now() / (FRESHNESS_SWEEP_DELAY_SECONDS * 1000),
        )}`,
        mode: 'SWEEP',
        supplierConnectionId: connection.id,
      },
    },
  ]);
}

/** Successors for a finished cycle: the next cycle's delayed start. */
export function nextCycleIntents(supplierConnectionId: string): OutboxIntent[] {
  return [
    cycleStartIntent({
      supplierConnectionId,
      keySuffix: `incremental:${Math.floor(Date.now() / (NEXT_CYCLE_DELAY_SECONDS * 1000))}`,
      delaySeconds: NEXT_CYCLE_DELAY_SECONDS,
    }),
  ];
}

export function laneContinuationIntents(input: {
  supplierConnectionId: string;
  lane: DiscoveryLane;
  immediate?: boolean;
}): OutboxIntent[] {
  if (input.lane === 'BOOTSTRAP') {
    return [
      cycleStartIntent({
        supplierConnectionId: input.supplierConnectionId,
        keySuffix: `incremental-after-bootstrap:${Date.now()}`,
      }),
    ];
  }

  return [
    cycleStartIntent({
      supplierConnectionId: input.supplierConnectionId,
      keySuffix: `incremental:${Math.floor(Date.now() / (NEXT_CYCLE_DELAY_SECONDS * 1000))}`,
      delaySeconds: NEXT_CYCLE_DELAY_SECONDS,
    }),
  ];
}
