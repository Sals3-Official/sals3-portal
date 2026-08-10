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
    cycleCutoff: string;
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
  budget: {
    pointsTotal: number | null;
    pointsRemaining: number | null;
    pointsUsedToday: number | null;
    pointsObservedAt: string | null;
    pausedUntil: string | null;
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
        cycleCutoff: cycle.cycleCutoff.toISOString(),
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
      budget:
        budget === null
          ? null
          : {
              pointsTotal: budget.pointsTotal,
              pointsRemaining: budget.pointsRemaining,
              pointsUsedToday: budget.pointsUsedToday,
              pointsObservedAt: budget.pointsObservedAt?.toISOString() ?? null,
              pausedUntil: budget.pausedUntil?.toISOString() ?? null,
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
