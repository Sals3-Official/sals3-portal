import { randomUUID } from 'crypto';
import getDb from '@/lib/db/client';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import CjSupplierAdapter from '@/modules/suppliers/providers/cj/cj-adapter';
import {
  findConnectionById,
  isWorkableConnectionStatus,
} from '@/modules/suppliers/repository';
import type {
  CatalogPage,
  CatalogPageQuery,
} from '@/modules/suppliers/contracts';
import { CjApiError } from '@/services/cj/config';
import type {
  DiscoveryPartitionRow,
  SupplierConnectionRow,
} from '@/lib/db/schema';
import {
  BUDGET_RETRY_DELAY_SECONDS,
  DISCOVERY_PAGE_SIZE,
  MAX_RECONCILE_ATTEMPTS,
  nextUtcMidnight,
  PRODUCT_LIST_POINTS_COST,
  RECONCILE_PAGES_PER_INVOCATION,
} from './config';
import formatCjCreateTime from './time-format';
import type { DiscoveryPartitionMessage } from './messages';
import validateCatalogPage, {
  validateSinglePageCompleteness,
} from './page-validation';
import planDensePartition from './partition-plan';
import coverageChecksum from './coverage-checksum';
import ingestDiscoveredProduct from './ingest-product';
import {
  assessBackgroundBudget,
  recordPointsInfo,
  recordRateLimitPause,
  tryAcquireRequestSlot,
} from './budget-repository';
import {
  advanceReconciliation,
  boundsOf,
  clearReconcilePids,
  completeReconcilePass,
  countPartitionsByState,
  countReconcilePids,
  coverPartition,
  failPartition,
  findPartitionById,
  insertPartitions,
  insertReconcilePids,
  leaseExhaustedPartition,
  leasePartition,
  listReconcilePids,
  markPartitionUnresolved,
  releasePartitionLease,
  splitPartition,
  type PartitionLease,
} from './partition-repository';
import {
  heartbeatCycle,
  recordPartitionSplit,
  recordPartitionTerminal,
  tryFinishCycle,
} from './cycle-repository';
import { insertOutboxIntents } from './outbox-repository';
import { recordDiscoveryFailure } from './failure-repository';
import { isDiscoveryRunning } from './run-state-repository';
import checkStorageGuard from './storage-guard';
import { nextCycleIntents, partitionMessageIntent } from './handle-cycle-start';

/**
 * DISCOVERY_PARTITION: proves (or refuses to claim) coverage for exactly one
 * partition, spending a bounded number of supplier requests per invocation:
 *
 * - reported total 0            -> COVERED (that partition only);
 * - total <= 200 (one page)     -> COVERED only when the valid unique PID
 *                                  set equals the reported total;
 * - total > 200, divisible      -> bisect by time, then price (density-
 *                                  driven; a total of 6,000+ is ordinary
 *                                  density data, never a special rule);
 * - at minimum time+price       -> atomic reconciliation: enumerate every
 *                                  page under the immutable filters and the
 *                                  fixed ordering, twice, and require two
 *                                  identical sorted-unique-PID checksums
 *                                  plus count == reported total;
 * - never converges             -> PROVIDER_COVERAGE_UNRESOLVED - visibly
 *                                  unresolved, blocks cycle COMPLETE.
 *
 * Any invalid response is rejected fail-closed: nothing ingests, no cursor
 * advances, no coverage is marked, and the partition stays visibly
 * incomplete with the exact contract error recorded.
 */

function buildQuery(
  partition: DiscoveryPartitionRow,
  pageNum: number,
): CatalogPageQuery {
  return {
    pageNum,
    pageSize: DISCOVERY_PAGE_SIZE,
    categoryId: partition.categoryId,
    ...(partition.createTimeFromMs === null
      ? {}
      : { createTimeFrom: formatCjCreateTime(partition.createTimeFromMs) }),
    createTimeTo: formatCjCreateTime(partition.createTimeToMs),
    ...(partition.priceFromCents === null
      ? {}
      : { minPrice: partition.priceFromCents / 100 }),
    ...(partition.priceToCents === null
      ? {}
      : { maxPrice: partition.priceToCents / 100 }),
  };
}

function retryDelaySeconds(attempts: number): number {
  return Math.min(30 * 2 ** Math.max(0, attempts - 1), 3_600);
}

type HandlerContext = {
  connection: SupplierConnectionRow;
  message: DiscoveryPartitionMessage;
};

/** Re-enqueue this partition after a transient obstacle, without advancing anything. */
async function parkAndRetry(
  lease: PartitionLease,
  context: HandlerContext,
  input: { errorCode: string; delaySeconds: number },
): Promise<void> {
  const db = getDb();

  await releasePartitionLease(db, {
    partitionId: lease.row.id,
    leaseToken: lease.leaseToken,
    errorCode: input.errorCode,
  });
  await insertOutboxIntents(db, [
    partitionMessageIntent({
      supplierConnectionId: context.connection.id,
      cycleId: lease.row.cycleId,
      partitionId: lease.row.id,
      keySuffix: `retry:${lease.row.attempts}:${input.errorCode}`,
      delaySeconds: input.delaySeconds,
    }),
  ]);
}

/**
 * Terminal bookkeeping in ONE transaction: the partition's guarded terminal
 * transition, the cycle counters, the cycle-completion attempt, and - when
 * the cycle just finished - the next cycle's delayed start intent.
 */
async function finishTerminal(
  lease: PartitionLease,
  input:
    | {
        kind: 'COVERED';
        reportedTotal: number;
        uniquePidCount: number;
        passChecksums: string[];
      }
    | {
        kind: 'UNRESOLVED';
        unresolvedReason: string;
        reportedTotal: number | null;
      }
    | { kind: 'FAILED'; errorCode: string },
): Promise<void> {
  const db = getDb();

  await db.transaction(async (tx) => {
    let transitioned: boolean;

    if (input.kind === 'COVERED') {
      transitioned = await coverPartition(tx, {
        partitionId: lease.row.id,
        leaseToken: lease.leaseToken,
        reportedTotal: input.reportedTotal,
        uniquePidCount: input.uniquePidCount,
        passChecksums: input.passChecksums,
      });
    } else if (input.kind === 'UNRESOLVED') {
      transitioned = await markPartitionUnresolved(tx, {
        partitionId: lease.row.id,
        leaseToken: lease.leaseToken,
        unresolvedReason: input.unresolvedReason,
        reportedTotal: input.reportedTotal,
      });
    } else {
      transitioned = await failPartition(tx, {
        partitionId: lease.row.id,
        leaseToken: lease.leaseToken,
        errorCode: input.errorCode,
      });
    }

    if (!transitioned) {
      // Lease lost - another worker owns this partition now. Change nothing.
      return;
    }

    await clearReconcilePids(tx, lease.row.id);
    await recordPartitionTerminal(tx, {
      cycleId: lease.row.cycleId,
      unresolved: input.kind !== 'COVERED',
    });

    const states = await countPartitionsByState(tx, lease.row.cycleId);
    const blockedPartitions =
      (states.PROVIDER_COVERAGE_UNRESOLVED ?? 0) + (states.FAILED ?? 0);
    const outcome = await tryFinishCycle(tx, {
      cycleId: lease.row.cycleId,
      blockedPartitions,
    });

    if (outcome !== 'STILL_RUNNING') {
      await insertOutboxIntents(
        tx,
        nextCycleIntents(lease.row.supplierConnectionId),
      );
    }

    if (input.kind !== 'COVERED') {
      await recordDiscoveryFailure(tx, {
        scope: 'DISCOVERY_PARTITION',
        referenceId: lease.row.id,
        errorCode:
          input.kind === 'UNRESOLVED'
            ? 'PROVIDER_COVERAGE_UNRESOLVED'
            : input.errorCode,
        detail:
          input.kind === 'UNRESOLVED' ? input.unresolvedReason : undefined,
        attempts: lease.row.attempts,
      });
    }
  });
}

/** One rate-limited, budget-gated supplier page fetch with shared classification. */
async function fetchPage(
  lease: PartitionLease,
  context: HandlerContext,
  pageNum: number,
): Promise<{ outcome: 'PAGE'; page: CatalogPage } | { outcome: 'PARKED' }> {
  const db = getDb();
  const budget = await assessBackgroundBudget(db, {
    supplierConnectionId: context.connection.id,
    requiredPoints: PRODUCT_LIST_POINTS_COST,
  });

  if (!budget.allowed) {
    await parkAndRetry(lease, context, {
      errorCode: `BUDGET_${budget.reason}`,
      delaySeconds: Math.max(
        60,
        Math.min(
          Math.ceil((budget.retryAt.getTime() - Date.now()) / 1000),
          BUDGET_RETRY_DELAY_SECONDS * 4,
        ),
      ),
    });
    return { outcome: 'PARKED' };
  }

  if (!(await tryAcquireRequestSlot(db, context.connection.id))) {
    await parkAndRetry(lease, context, {
      errorCode: 'RATE_SLOT_UNAVAILABLE',
      delaySeconds: 10,
    });
    return { outcome: 'PARKED' };
  }

  const secretStore = new PostgresSupplierSecretStore();
  const adapter = new CjSupplierAdapter(
    secretStore,
    new CjTokenManager(secretStore),
  );

  try {
    const page = await adapter.listCatalogPage(
      context.connection.id,
      buildQuery(lease.row, pageNum),
    );

    await recordPointsInfo(db, context.connection.id, page.pointsInfo);

    return { outcome: 'PAGE', page };
  } catch (error) {
    if (error instanceof CjApiError && error.reason === 'rate-limited') {
      // HTTP 429: no aggressive retries - persist the pause aligned with
      // the documented refill/reset behavior and continue via queue delay.
      const resumeAt = new Date(
        Math.min(
          nextUtcMidnight(new Date()).getTime(),
          Date.now() + BUDGET_RETRY_DELAY_SECONDS * 1000,
        ),
      );

      await recordRateLimitPause(db, context.connection.id, resumeAt);
      await parkAndRetry(lease, context, {
        errorCode: 'PROVIDER_RATE_LIMITED',
        delaySeconds: Math.max(
          60,
          Math.ceil((resumeAt.getTime() - Date.now()) / 1000),
        ),
      });
      return { outcome: 'PARKED' };
    }

    await parkAndRetry(lease, context, {
      errorCode: 'PROVIDER_FETCH_FAILED',
      delaySeconds: retryDelaySeconds(lease.row.attempts),
    });
    return { outcome: 'PARKED' };
  }
}

/** Validation failure: record the exact contract error, never ingest/advance. */
async function rejectInvalidPage(
  lease: PartitionLease,
  context: HandlerContext,
  validation: { errorCode: string; detail: string },
): Promise<void> {
  await recordDiscoveryFailure(getDb(), {
    scope: 'DISCOVERY_PARTITION',
    referenceId: lease.row.id,
    errorCode: validation.errorCode,
    detail: validation.detail,
    attempts: lease.row.attempts,
  });
  await parkAndRetry(lease, context, {
    errorCode: validation.errorCode,
    delaySeconds: retryDelaySeconds(lease.row.attempts),
  });
}

/** First probe of a PENDING partition. */
async function probePartition(
  lease: PartitionLease,
  context: HandlerContext,
): Promise<void> {
  const db = getDb();
  const fetched = await fetchPage(lease, context, 1);

  if (fetched.outcome === 'PARKED') return;

  const { page } = fetched;
  const validation = validateCatalogPage(page, {
    requestedPageNum: 1,
    requestedPageSize: DISCOVERY_PAGE_SIZE,
  });

  if (!validation.ok) {
    await rejectInvalidPage(lease, context, validation);
    return;
  }

  if (page.total === 0) {
    // Only THIS partition is covered - an empty window proves nothing about
    // any other partition.
    await finishTerminal(lease, {
      kind: 'COVERED',
      reportedTotal: 0,
      uniquePidCount: 0,
      passChecksums: [],
    });
    return;
  }

  if (page.total <= DISCOVERY_PAGE_SIZE) {
    const completeness = validateSinglePageCompleteness(page);

    if (!completeness.ok) {
      await rejectInvalidPage(lease, context, completeness);
      return;
    }

    // Ingest every product (each in its own durable transaction with its
    // status and evaluation intent), then prove coverage.
    // eslint-disable-next-line no-restricted-syntax -- sequential keeps DB pressure bounded; page size <= 200.
    for (const product of page.products) {
      // eslint-disable-next-line no-await-in-loop -- see above.
      await ingestDiscoveredProduct(product, context.connection, {
        cycleId: lease.row.cycleId,
        partitionId: lease.row.id,
      });
    }

    const uniquePids = [...new Set(page.products.map((p) => p.id))];

    await finishTerminal(lease, {
      kind: 'COVERED',
      reportedTotal: page.total,
      uniquePidCount: uniquePids.length,
      passChecksums: [
        coverageChecksum({
          partitionId: lease.row.id,
          categoryId: lease.row.categoryId,
          timeFromMs: lease.row.createTimeFromMs,
          timeToMs: lease.row.createTimeToMs,
          priceFromCents: lease.row.priceFromCents,
          priceToCents: lease.row.priceToCents,
          uniquePids,
        }),
      ],
    });
    return;
  }

  // Dense partition. Ingest the probe page opportunistically (idempotent;
  // coverage proof still comes from the children), then split or reconcile.
  // eslint-disable-next-line no-restricted-syntax -- sequential keeps DB pressure bounded.
  for (const product of page.products) {
    // eslint-disable-next-line no-await-in-loop -- see above.
    await ingestDiscoveredProduct(product, context.connection, {
      cycleId: lease.row.cycleId,
      partitionId: lease.row.id,
    });
  }

  const plan = planDensePartition(boundsOf(lease.row));

  if (plan.kind === 'ATOMIC_RECONCILE') {
    const advanced = await advanceReconciliation(db, {
      partitionId: lease.row.id,
      leaseToken: lease.leaseToken,
      reconcilePass: 1,
      reconcileNextPage: 1,
      reportedTotal: page.total,
      releaseLease: true,
    });

    if (advanced) {
      await insertOutboxIntents(db, [
        partitionMessageIntent({
          supplierConnectionId: context.connection.id,
          cycleId: lease.row.cycleId,
          partitionId: lease.row.id,
          keySuffix: 'reconcile:1:1',
        }),
      ]);
    }
    return;
  }

  await db.transaction(async (tx) => {
    const transitioned = await splitPartition(tx, {
      partitionId: lease.row.id,
      leaseToken: lease.leaseToken,
      reportedTotal: page.total,
    });

    if (!transitioned) return;

    const children = await insertPartitions(
      tx,
      plan.children.map((bounds) => ({
        cycleId: lease.row.cycleId,
        supplierConnectionId: lease.row.supplierConnectionId,
        parentPartitionId: lease.row.id,
        depth: lease.row.depth + 1,
        categoryId: bounds.categoryId,
        createTimeFromMs: bounds.timeFromMs,
        createTimeToMs: bounds.timeToMs,
        priceFromCents: bounds.priceFromCents,
        priceToCents: bounds.priceToCents,
      })),
    );

    await recordPartitionSplit(tx, {
      cycleId: lease.row.cycleId,
      childrenAdded: children.length,
    });
    await insertOutboxIntents(
      tx,
      children.map((child) =>
        partitionMessageIntent({
          supplierConnectionId: context.connection.id,
          cycleId: lease.row.cycleId,
          partitionId: child.id,
          keySuffix: 'initial',
        }),
      ),
    );
  });
}

/** Resumable atomic-bucket reconciliation (RECONCILING state). */
async function continueReconciliation(
  lease: PartitionLease,
  context: HandlerContext,
): Promise<void> {
  const db = getDb();
  let pass = lease.row.reconcilePass ?? 1;
  let nextPage = lease.row.reconcileNextPage ?? 1;
  let reportedTotal = lease.row.reportedTotal ?? 0;
  let { passChecksums: checksums, reconcileAttempts } = lease.row;

  for (let i = 0; i < RECONCILE_PAGES_PER_INVOCATION; i += 1) {
    // eslint-disable-next-line no-await-in-loop -- pages are sequential by contract (fixed ordering) and rate limit.
    const fetched = await fetchPage(lease, context, nextPage);

    if (fetched.outcome === 'PARKED') return;

    const { page } = fetched;
    const validation = validateCatalogPage(page, {
      requestedPageNum: nextPage,
      requestedPageSize: DISCOVERY_PAGE_SIZE,
    });

    if (!validation.ok) {
      // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
      await rejectInvalidPage(lease, context, validation);
      return;
    }

    reportedTotal = page.total;

    // Ingest (idempotent) and accumulate this page's PIDs for the pass.
    // eslint-disable-next-line no-restricted-syntax -- bounded page, sequential DB pressure.
    for (const product of page.products) {
      // eslint-disable-next-line no-await-in-loop -- see above.
      await ingestDiscoveredProduct(product, context.connection, {
        cycleId: lease.row.cycleId,
        partitionId: lease.row.id,
      });
    }

    // eslint-disable-next-line no-await-in-loop -- sequential by design.
    await insertReconcilePids(db, {
      partitionId: lease.row.id,
      pass,
      pids: page.products.map((p) => p.id),
    });

    if (nextPage < page.totalPages) {
      nextPage += 1;
      // eslint-disable-next-line no-await-in-loop -- sequential by design.
      const advanced = await advanceReconciliation(db, {
        partitionId: lease.row.id,
        leaseToken: lease.leaseToken,
        reconcilePass: pass,
        reconcileNextPage: nextPage,
        reportedTotal,
        releaseLease: false,
      });

      if (!advanced) return; // Lease lost; a newer worker owns the cursor.
      // eslint-disable-next-line no-continue -- proceed to the next page in this invocation's budget.
      continue;
    }

    // --- Pass complete -------------------------------------------------
    // eslint-disable-next-line no-await-in-loop -- sequential by design.
    const uniquePids = await listReconcilePids(db, {
      partitionId: lease.row.id,
      pass,
    });
    const checksum = coverageChecksum({
      partitionId: lease.row.id,
      categoryId: lease.row.categoryId,
      timeFromMs: lease.row.createTimeFromMs,
      timeToMs: lease.row.createTimeToMs,
      priceFromCents: lease.row.priceFromCents,
      priceToCents: lease.row.priceToCents,
      uniquePids,
    });

    // eslint-disable-next-line no-await-in-loop -- sequential by design.
    const recorded = await completeReconcilePass(db, {
      partitionId: lease.row.id,
      leaseToken: lease.leaseToken,
      checksum,
      nextPass: pass + 1,
    });

    if (!recorded) return; // Lease lost.

    checksums = [...checksums, checksum];
    reconcileAttempts += 1;

    const previousChecksum = checksums[checksums.length - 2];

    if (previousChecksum === checksum) {
      // Two consecutive complete passes agree; the unique count must also
      // equal the provider's reported total or coverage is NOT proven.
      // eslint-disable-next-line no-await-in-loop -- sequential by design.
      const uniqueCount = await countReconcilePids(db, {
        partitionId: lease.row.id,
        pass,
      });

      if (uniqueCount === reportedTotal) {
        // eslint-disable-next-line no-await-in-loop -- sequential by design.
        await finishTerminal(lease, {
          kind: 'COVERED',
          reportedTotal,
          uniquePidCount: uniqueCount,
          passChecksums: checksums,
        });
        return;
      }

      // eslint-disable-next-line no-await-in-loop -- sequential by design.
      await recordDiscoveryFailure(db, {
        scope: 'DISCOVERY_PARTITION',
        referenceId: lease.row.id,
        errorCode: 'RECONCILE_COUNT_MISMATCH',
        detail: `Stable checksum but unique count ${uniqueCount} != reported total ${reportedTotal}.`,
        attempts: reconcileAttempts,
      });
    }

    if (reconcileAttempts >= MAX_RECONCILE_ATTEMPTS) {
      // Bounded retries exhausted without two identical complete passes
      // (or with a count mismatch): the partition is visibly unresolved.
      // A partially validated pass is never proof of complete coverage.
      // eslint-disable-next-line no-await-in-loop -- sequential by design.
      await finishTerminal(lease, {
        kind: 'UNRESOLVED',
        unresolvedReason: `No two consecutive identical complete passes with count == total after ${reconcileAttempts} passes.`,
        reportedTotal,
      });
      return;
    }

    // Start the next pass via a fresh message (bounded work per invocation).
    pass += 1;
    nextPage = 1;
    // eslint-disable-next-line no-await-in-loop -- sequential by design.
    await advanceReconciliation(db, {
      partitionId: lease.row.id,
      leaseToken: lease.leaseToken,
      reconcilePass: pass,
      reconcileNextPage: 1,
      reportedTotal,
      releaseLease: true,
    });
    // eslint-disable-next-line no-await-in-loop -- sequential by design.
    await insertOutboxIntents(db, [
      partitionMessageIntent({
        supplierConnectionId: context.connection.id,
        cycleId: lease.row.cycleId,
        partitionId: lease.row.id,
        keySuffix: `reconcile:${pass}:1`,
      }),
    ]);
    return;
  }

  // Page budget for this invocation exhausted mid-pass: persist the cursor,
  // release the lease, and continue in a successor message.
  await advanceReconciliation(db, {
    partitionId: lease.row.id,
    leaseToken: lease.leaseToken,
    reconcilePass: pass,
    reconcileNextPage: nextPage,
    reportedTotal,
    releaseLease: true,
  });
  await insertOutboxIntents(db, [
    partitionMessageIntent({
      supplierConnectionId: context.connection.id,
      cycleId: lease.row.cycleId,
      partitionId: lease.row.id,
      keySuffix: `reconcile:${pass}:${nextPage}`,
    }),
  ]);
}

export default async function handlePartition(
  message: DiscoveryPartitionMessage,
): Promise<void> {
  const db = getDb();
  const connection = await findConnectionById(db, message.supplierConnectionId);

  if (connection === null || !isWorkableConnectionStatus(connection.status)) {
    // Connection health pause - the reconnect path resumes the chain.
    return;
  }

  if (!(await isDiscoveryRunning(db, connection.id))) {
    // Paused: park without supplier work; Resume re-enqueues the sweep.
    return;
  }

  const storage = await checkStorageGuard(db);

  if (storage.pauseBroadDiscovery) {
    await recordDiscoveryFailure(db, {
      scope: 'DISCOVERY_PARTITION',
      referenceId: message.partitionId,
      errorCode: 'STORAGE_GUARD_PAUSED',
      detail: `Database at ${storage.usedPercent}% of the configured allowance.`,
    });
    return;
  }

  const partition = await findPartitionById(db, message.partitionId);

  if (partition === null || partition.cycleId !== message.cycleId) return;
  if (partition.state !== 'PENDING' && partition.state !== 'RECONCILING') {
    // Terminal already - a duplicate or out-of-order delivery. Ack.
    return;
  }

  await heartbeatCycle(db, partition.cycleId);

  const leaseToken = randomUUID();
  const lease = await leasePartition(db, {
    partitionId: partition.id,
    leaseToken,
  });

  if (lease === null) {
    // Another worker holds the lease, or attempts are exhausted. Exhaustion
    // must surface, not vanish: take the failure-only lease and mark the
    // partition FAILED - a visible operational state that blocks cycle
    // completion, never a silent disappearance.
    const failLease = await leaseExhaustedPartition(db, {
      partitionId: partition.id,
      leaseToken: randomUUID(),
    });

    if (failLease !== null) {
      await finishTerminal(failLease, {
        kind: 'FAILED',
        errorCode:
          failLease.row.lastErrorCode ?? 'PARTITION_ATTEMPTS_EXHAUSTED',
      });
    }

    return;
  }

  if (lease.row.state === 'PENDING') {
    await probePartition(lease, { connection, message });
    return;
  }

  await continueReconciliation(lease, { connection, message });
}
