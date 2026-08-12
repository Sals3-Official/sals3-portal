import getDb from '@/lib/db/client';
import { listWorkableConnections } from '@/modules/suppliers/repository';
import { findRunState } from './run-state-repository';
import { findActiveCycle } from './cycle-repository';
import {
  countPartitionsByState,
  listBlockedPartitions,
} from './partition-repository';
import { findBudgetRow } from './budget-repository';
import { summarizeOutbox } from './outbox-repository';
import { countRecentFailures } from './failure-repository';
import checkStorageGuard, { type StorageGuardStatus } from './storage-guard';
import { findWatermark } from './lane-repository';
import { countSubscriptionsByPriority } from './subscription-repository';
import { readIntakeGateStatus } from './intake-gate-repository';
import { listCuratedLanes } from './curated-lane-repository';

/**
 * Operational status read model for GET /api/internal/catalog/discovery/
 * status. Reports coverage truthfully: unresolved/failed partitions are
 * first-class, and a cycle is only ever COMPLETE when every partition
 * proved coverage. No supplier secrets, tokens, or payloads appear here.
 */

export type ConnectionDiscoveryStatus = {
  supplierConnectionId: string;
  runState: 'RUNNING' | 'PAUSED' | 'NEVER_STARTED';
  cycle: {
    id: string;
    state: string;
    lane: string;
    cycleCutoff: string;
    windowFrom: string | null;
    startedAt: string;
    lastHeartbeatAt: string | null;
    partitionsTotal: number;
    partitionsTerminal: number;
    partitionsUnresolved: number;
    partitionsByState: Record<string, number>;
    blockedPartitions: Array<{
      id: string;
      state: string;
      categoryId: string;
      unresolvedReason: string | null;
      lastErrorCode: string | null;
      reportedTotal: number | null;
    }>;
  } | null;
  incremental: {
    bootstrapCutoff: string | null;
    provenCutoff: string | null;
    nextWindowFrom: string | null;
    safetyOverlapSeconds: number | null;
  } | null;
  subscriptions: {
    priorityClass: string;
    desiredState: string;
    observedState: string;
    count: number;
  }[];
  /**
   * The one-time existing-backlog drain gate. While this is not
   * `DRAIN_COMPLETE`, no lane may make a new broad `product/list` request.
   */
  backlog: {
    state: string;
    activationAt: string | null;
    baselineBacklogCount: number | null;
    actionableBacklogCount: number | null;
    drainCompletedAt: string | null;
  };
  /**
   * The owner's active rolling new-unique-PID intake wave. `currentWaveLimit`
   * is what the durable ledger is enforcing, which is the number that matters
   * - not whatever the reading process has in its own environment.
   */
  newPidCapacity: {
    enabled: boolean;
    waveSize: number;
    currentWaveLimit: number | null;
    admittedCount: number | null;
    remainingInWave: number | null;
    activeEvaluationWork: number;
    capReachedAt: string | null;
  };
  /** Curated CJ lanes: cursor, counters, and the exact current pause reason. */
  curatedLanes: {
    lane: string;
    state: string;
    nextPage: number;
    pagesFetched: number;
    newPidsAdmitted: number;
    signalsRecorded: number;
    lastPauseReason: string | null;
    lastErrorCode: string | null;
    lastRunAt: string | null;
  }[];
  budget: {
    pointsTotal: number | null;
    pointsRemaining: number | null;
    pointsUsedToday: number | null;
    pointsObservedAt: string | null;
    pausedUntil: string | null;
    providerPauseReason: string | null;
    nextSafeRefillAt: string | null;
  } | null;
};

export type DiscoveryStatus = {
  generatedAt: string;
  connections: ConnectionDiscoveryStatus[];
  outbox: { pending: number; failed: number; oldestPendingAt: string | null };
  recentFailures24h: number;
  storage: StorageGuardStatus;
};

export default async function getDiscoveryStatus(): Promise<DiscoveryStatus> {
  const db = getDb();
  const connections = await listWorkableConnections(db);
  const results: ConnectionDiscoveryStatus[] = [];

  // eslint-disable-next-line no-restricted-syntax -- a handful of connections.
  for (const connection of connections) {
    // eslint-disable-next-line no-await-in-loop -- sequential status reads.
    const runState = await findRunState(db, connection.id);
    // eslint-disable-next-line no-await-in-loop -- sequential status reads.
    const cycle = await findActiveCycle(db, connection.id);
    // eslint-disable-next-line no-await-in-loop -- sequential status reads.
    const budget = await findBudgetRow(db, connection.id);
    // eslint-disable-next-line no-await-in-loop -- sequential status reads.
    const watermark = await findWatermark(db, connection.id);
    // eslint-disable-next-line no-await-in-loop -- sequential status reads.
    const subscriptions = await countSubscriptionsByPriority(db, connection.id);
    // eslint-disable-next-line no-await-in-loop -- sequential status reads.
    const intake = await readIntakeGateStatus(db, connection.id);
    // eslint-disable-next-line no-await-in-loop -- sequential status reads.
    const curatedLanes = await listCuratedLanes(db, connection.id);

    let cycleStatus: ConnectionDiscoveryStatus['cycle'] = null;

    if (cycle !== null) {
      // eslint-disable-next-line no-await-in-loop -- sequential status reads.
      const partitionsByState = await countPartitionsByState(db, cycle.id);
      // eslint-disable-next-line no-await-in-loop -- sequential status reads.
      const blocked = await listBlockedPartitions(db, {
        cycleId: cycle.id,
        limit: 25,
      });

      cycleStatus = {
        id: cycle.id,
        state: cycle.state,
        lane: cycle.lane,
        cycleCutoff: cycle.cycleCutoff.toISOString(),
        windowFrom: cycle.windowFrom?.toISOString() ?? null,
        startedAt: cycle.startedAt.toISOString(),
        lastHeartbeatAt: cycle.lastHeartbeatAt?.toISOString() ?? null,
        partitionsTotal: cycle.partitionsTotal,
        partitionsTerminal: cycle.partitionsTerminal,
        partitionsUnresolved: cycle.partitionsUnresolved,
        partitionsByState,
        blockedPartitions: blocked.map((partition) => ({
          id: partition.id,
          state: partition.state,
          categoryId: partition.categoryId,
          unresolvedReason: partition.unresolvedReason,
          lastErrorCode: partition.lastErrorCode,
          reportedTotal: partition.reportedTotal,
        })),
      };
    }

    let runStateLabel: ConnectionDiscoveryStatus['runState'] = 'NEVER_STARTED';

    if (runState !== null) {
      runStateLabel =
        runState.desiredState === 'RUNNING' ? 'RUNNING' : 'PAUSED';
    }

    results.push({
      supplierConnectionId: connection.id,
      runState: runStateLabel,
      cycle: cycleStatus,
      incremental:
        watermark === null
          ? null
          : {
              bootstrapCutoff: watermark.bootstrapCutoff?.toISOString() ?? null,
              provenCutoff: watermark.provenCutoff?.toISOString() ?? null,
              nextWindowFrom: watermark.nextWindowFrom?.toISOString() ?? null,
              safetyOverlapSeconds: watermark.safetyOverlapSeconds,
            },
      backlog: intake.backlog,
      newPidCapacity: intake.newPidCapacity,
      curatedLanes: curatedLanes.map((row) => ({
        lane: row.lane,
        state: row.state,
        nextPage: row.nextPage,
        pagesFetched: row.pagesFetched,
        newPidsAdmitted: row.newPidsAdmitted,
        signalsRecorded: row.signalsRecorded,
        lastPauseReason: row.lastPauseReason,
        lastErrorCode: row.lastErrorCode,
        lastRunAt: row.lastRunAt?.toISOString() ?? null,
      })),
      subscriptions: subscriptions.map((row) => ({
        priorityClass: row.priorityClass,
        desiredState: row.desiredState,
        observedState: row.observedState,
        count: row.count,
      })),
      budget:
        budget === null
          ? null
          : {
              pointsTotal: budget.pointsTotal,
              pointsRemaining: budget.pointsRemaining,
              pointsUsedToday: budget.pointsUsedToday,
              pointsObservedAt: budget.pointsObservedAt?.toISOString() ?? null,
              pausedUntil: budget.pausedUntil?.toISOString() ?? null,
              providerPauseReason: budget.providerPauseReason,
              nextSafeRefillAt: budget.nextSafeRefillAt?.toISOString() ?? null,
            },
    });
  }

  const outbox = await summarizeOutbox(db);
  const recentFailures24h = await countRecentFailures(
    db,
    new Date(Date.now() - 24 * 60 * 60 * 1000),
  );
  const storage = await checkStorageGuard(db);

  return {
    generatedAt: new Date().toISOString(),
    connections: results,
    outbox: {
      pending: outbox.pending,
      failed: outbox.failed,
      oldestPendingAt: outbox.oldestPendingAt?.toISOString() ?? null,
    },
    recentFailures24h,
    storage,
  };
}
