import { randomUUID } from 'crypto';
import getDb from '@/lib/db/client';
import PostgresSupplierSecretStore from '@/lib/secrets/postgres-supplier-secret-store';
import CjTokenManager from '@/modules/suppliers/providers/cj/cj-auth';
import CjSupplierAdapter from '@/modules/suppliers/providers/cj/cj-adapter';
import {
  findConnectionById,
  isWorkableConnectionStatus,
} from '@/modules/suppliers/repository';
import { CjApiError } from '@/services/cj/config';
import {
  BACKLOG_DRAIN_RETRY_SECONDS,
  BUDGET_RETRY_DELAY_SECONDS,
  CURATED_MAX_PAGES,
  CURATED_NEW_ARRIVAL_WINDOW_DAYS,
  CURATED_PAGES_PER_INVOCATION,
  CURATED_PAGE_SIZE,
  CURATED_SWEEP_DELAY_SECONDS,
  PRODUCT_LIST_POINTS_COST,
} from './config';
import type { DiscoveryCuratedLaneMessage } from './messages';
import {
  assessBackgroundBudget,
  recordPointsInfo,
  recordRateLimitPause,
  tryAcquireRequestSlot,
} from './budget-repository';
import {
  advanceCuratedLane,
  ensureCuratedLanes,
  leaseCuratedLane,
  pauseCuratedLane,
  type CuratedLaneLease,
} from './curated-lane-repository';
import {
  CURATED_LANE_DEFINITIONS,
  signalsForObservation,
} from './curated-lanes';
import { assessIntakeGate } from './intake-gate-repository';
import drainExistingBacklog from './backlog-drain';
import ingestDiscoveredProduct from './ingest-product';
import validateCatalogPage from './page-validation';
import { insertOutboxIntents, type OutboxIntent } from './outbox-repository';
import { recordDiscoveryFailure } from './failure-repository';
import { isDiscoveryRunning } from './run-state-repository';
import checkStorageGuard from './storage-guard';

/**
 * DISCOVERY_CURATED_LANE: one bounded run of a curated CJ lane (Trending /
 * Most listed / New arrivals).
 *
 * Every constraint the canonical scanner obeys applies here unchanged:
 *
 * - legacy `GET /api2.0/v1/product/list` only, never `listV2`;
 * - the ONE-TIME existing-backlog drain gate must be complete first;
 * - the SAME durable new-unique-PID ledger is consumed - curated lanes get no
 *   hidden second budget, cannot double-count a PID, and stop calling CJ the
 *   moment the ceiling is reached;
 * - the shared request limiter and background points reserve still apply;
 * - lease/CAS plus outbox intents, so duplicate delivery or concurrent
 *   workers create one logical observation and one capacity consumption per
 *   new PID.
 *
 * What it must never do: mark a partition, cycle, or catalogue complete, or
 * change a product's lifecycle status, market eligibility, or manual
 * stock-review state. It records signal observations and nothing else.
 */

export function curatedLaneIntent(input: {
  supplierConnectionId: string;
  lane: DiscoveryCuratedLaneMessage['lane'];
  keySuffix: string;
  delaySeconds?: number;
}): OutboxIntent {
  return {
    message: {
      v: 1,
      operation: 'DISCOVERY_CURATED_LANE',
      idempotencyKey: `curated:${input.supplierConnectionId}:${input.lane}:${input.keySuffix}`,
      supplierConnectionId: input.supplierConnectionId,
      lane: input.lane,
    },
    delaySeconds: input.delaySeconds,
  };
}

function sweepWindowKey(): number {
  return Math.floor(Date.now() / (CURATED_SWEEP_DELAY_SECONDS * 1000));
}

/** Re-enqueue this lane after a transient obstacle, without advancing anything. */
async function pauseAndRetry(
  lease: CuratedLaneLease,
  input: {
    supplierConnectionId: string;
    reason: string;
    delaySeconds: number;
    consumeAttempt?: boolean;
  },
): Promise<void> {
  const db = getDb();

  await pauseCuratedLane(db, {
    supplierConnectionId: input.supplierConnectionId,
    lane: lease.row.lane,
    leaseToken: lease.leaseToken,
    reason: input.reason,
    errorCode: input.reason,
    consumeAttempt: input.consumeAttempt,
  });
  await insertOutboxIntents(db, [
    curatedLaneIntent({
      supplierConnectionId: input.supplierConnectionId,
      lane: lease.row.lane,
      keySuffix: `retry:${input.reason}:${Math.floor(
        Date.now() / Math.max(1, input.delaySeconds * 1000),
      )}`,
      delaySeconds: input.delaySeconds,
    }),
  ]);
}

/**
 * The `New arrivals` window is fixed when a run starts and preserved across
 * continuations, so a multi-message run enumerates ONE stable interval rather
 * than a window that slides under its own pagination and re-reports the same
 * products as new. Every other lane has no time bounds at all.
 */
function resolveNewArrivalWindow(input: {
  lane: DiscoveryCuratedLaneMessage['lane'];
  isFreshRun: boolean;
  storedFromMs: number | null;
  storedToMs: number | null;
}): { windowFromMs: number | null; windowToMs: number | null } {
  if (input.lane !== 'CJ_NEW_ARRIVALS') {
    return { windowFromMs: null, windowToMs: null };
  }

  const spanMs = CURATED_NEW_ARRIVAL_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  if (input.isFreshRun) {
    const windowToMs = Date.now();

    return { windowFromMs: windowToMs - spanMs, windowToMs };
  }

  const windowToMs = input.storedToMs ?? Date.now();

  return {
    windowFromMs: input.storedFromMs ?? windowToMs - spanMs,
    windowToMs,
  };
}

export default async function handleCuratedLane(
  message: DiscoveryCuratedLaneMessage,
): Promise<void> {
  const db = getDb();
  const connection = await findConnectionById(db, message.supplierConnectionId);

  if (connection === null || !isWorkableConnectionStatus(connection.status)) {
    return;
  }

  if (!(await isDiscoveryRunning(db, connection.id))) {
    // Paused: curated lanes are background supplier spend too.
    return;
  }

  const storage = await checkStorageGuard(db);

  if (storage.pauseBroadDiscovery) {
    await recordDiscoveryFailure(db, {
      scope: 'DISCOVERY_CURATED_LANE',
      referenceId: `${connection.id}:${message.lane}`,
      errorCode: 'STORAGE_GUARD_PAUSED',
      detail: `Database at ${storage.usedPercent}% of the configured allowance.`,
    });
    return;
  }

  await ensureCuratedLanes(db, connection.id);

  const lease = await leaseCuratedLane(db, {
    supplierConnectionId: connection.id,
    lane: message.lane,
    leaseToken: randomUUID(),
  });

  if (lease === null) return; // Another worker owns this lane right now.

  const definition = CURATED_LANE_DEFINITIONS[message.lane];
  const secretStore = new PostgresSupplierSecretStore();
  const adapter = new CjSupplierAdapter(
    secretStore,
    new CjTokenManager(secretStore),
  );

  const { nextPage: startPage, pagesFetched: startPagesFetched } = lease.row;
  const { windowFromMs, windowToMs } = resolveNewArrivalWindow({
    lane: message.lane,
    isFreshRun: startPage === 1,
    storedFromMs: lease.row.windowFromMs,
    storedToMs: lease.row.windowToMs,
  });

  let nextPage = startPage;
  let pagesFetched = startPagesFetched;
  let newPidsAdmitted = 0;
  let signalsRecorded = 0;
  let exhaustedProviderPages = false;
  /** The wave edge this invocation actually worked against, once admitted. */
  let currentWaveLimit: number | null = null;

  for (let i = 0; i < CURATED_PAGES_PER_INVOCATION; i += 1) {
    if (pagesFetched >= CURATED_MAX_PAGES) break;

    // Backlog first, then the shared rolling new-PID wave - BEFORE the call.
    // eslint-disable-next-line no-await-in-loop -- pages are sequential by rate limit.
    const intake = await assessIntakeGate(db, {
      supplierConnectionId: connection.id,
      requiredCapacity: CURATED_PAGE_SIZE,
      intent: message.lane,
    });

    if (intake.allowed) currentWaveLimit = intake.currentWaveLimit;

    if (!intake.allowed) {
      if (intake.reason === 'BACKLOG_DRAIN_PENDING') {
        // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
        await drainExistingBacklog(connection.id);
      }

      let detail: string;

      if (intake.reason === 'BACKLOG_DRAIN_PENDING') {
        detail = `Deferred: ${intake.backlogCount} actionable Candidate Pipeline rows must drain first.`;
      } else if (intake.reason === 'NEW_PID_WAVE_DRAIN_PENDING') {
        detail = `Deferred: current ${intake.waveSize}-product wave is full at ${intake.admittedCount}/${intake.limitValue}; ${intake.activeEvaluationWork} active Candidate Pipeline rows must finish before the next wave opens.`;
      } else if (intake.reason === 'HIGHER_PRIORITY_INTAKE_PENDING') {
        detail = `Deferred: ${intake.blockedBy} holds the intake floor for this wave under the owner priority order.`;
      } else {
        detail = `Deferred: ${intake.admittedCount}/${intake.limitValue} new PIDs admitted, ${intake.remainingCapacity} remaining.`;
      }

      // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
      await recordDiscoveryFailure(db, {
        scope: 'DISCOVERY_CURATED_LANE',
        referenceId: `${connection.id}:${message.lane}`,
        errorCode: intake.reason,
        detail,
      });
      // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
      await pauseAndRetry(lease, {
        supplierConnectionId: connection.id,
        reason: intake.reason,
        consumeAttempt: false,
        delaySeconds:
          intake.reason === 'BACKLOG_DRAIN_PENDING'
            ? BACKLOG_DRAIN_RETRY_SECONDS
            : BUDGET_RETRY_DELAY_SECONDS * 4,
      });
      return;
    }

    // eslint-disable-next-line no-await-in-loop -- sequential by design.
    const budget = await assessBackgroundBudget(db, {
      supplierConnectionId: connection.id,
      requiredPoints: PRODUCT_LIST_POINTS_COST,
    });

    if (!budget.allowed) {
      // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
      await pauseAndRetry(lease, {
        supplierConnectionId: connection.id,
        reason: `BUDGET_${budget.reason}`,
        consumeAttempt: false,
        delaySeconds: Math.max(
          60,
          Math.min(
            Math.ceil((budget.retryAt.getTime() - Date.now()) / 1000),
            BUDGET_RETRY_DELAY_SECONDS * 4,
          ),
        ),
      });
      return;
    }

    // eslint-disable-next-line no-await-in-loop -- sequential by design.
    if (!(await tryAcquireRequestSlot(db, connection.id))) {
      // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
      await pauseAndRetry(lease, {
        supplierConnectionId: connection.id,
        reason: 'RATE_SLOT_UNAVAILABLE',
        consumeAttempt: false,
        delaySeconds: 10,
      });
      return;
    }

    const query = definition.buildQuery({
      pageNum: nextPage,
      windowFromMs,
      windowToMs,
    });
    let page;

    try {
      // eslint-disable-next-line no-await-in-loop -- sequential by design.
      page = await adapter.listCuratedPage(connection.id, query);
    } catch (error) {
      if (error instanceof CjApiError && error.reason === 'rate-limited') {
        const resumeAt = new Date(
          Date.now() + BUDGET_RETRY_DELAY_SECONDS * 1000,
        );

        // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
        await recordRateLimitPause(db, connection.id, resumeAt);
        // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
        await pauseAndRetry(lease, {
          supplierConnectionId: connection.id,
          reason: 'PROVIDER_RATE_LIMITED',
          consumeAttempt: false,
          delaySeconds: BUDGET_RETRY_DELAY_SECONDS,
        });
        return;
      }

      // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
      await recordDiscoveryFailure(db, {
        scope: 'DISCOVERY_CURATED_LANE',
        referenceId: `${connection.id}:${message.lane}`,
        errorCode: 'PROVIDER_FETCH_FAILED',
        attempts: lease.row.attempts,
      });
      // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
      await pauseAndRetry(lease, {
        supplierConnectionId: connection.id,
        reason: 'PROVIDER_FETCH_FAILED',
        delaySeconds: Math.min(
          30 * 2 ** Math.max(0, lease.row.attempts),
          3_600,
        ),
      });
      return;
    }

    // eslint-disable-next-line no-await-in-loop -- sequential by design.
    await recordPointsInfo(db, connection.id, page.pointsInfo);

    const validation = validateCatalogPage(page, {
      requestedPageNum: nextPage,
      requestedPageSize: CURATED_PAGE_SIZE,
    });

    if (!validation.ok) {
      // A curated lane's contract failure is an ordinary recorded error. It
      // proves nothing about coverage either way, so nothing is marked.
      // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
      await recordDiscoveryFailure(db, {
        scope: 'DISCOVERY_CURATED_LANE',
        referenceId: `${connection.id}:${message.lane}`,
        errorCode: validation.errorCode,
        detail: validation.detail,
        attempts: lease.row.attempts,
      });
      // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
      await pauseAndRetry(lease, {
        supplierConnectionId: connection.id,
        reason: validation.errorCode,
        delaySeconds: 3_600,
      });
      return;
    }

    const sourceQuery = definition.describeQuery(query);
    let capReachedMidPage = false;

    // eslint-disable-next-line no-restricted-syntax -- bounded page, sequential DB pressure.
    for (const product of page.products) {
      const signals = signalsForObservation(message.lane, product.listedCount);

      // eslint-disable-next-line no-await-in-loop -- see above.
      const outcome = await ingestDiscoveredProduct(product, connection, {
        cycleId: null,
        partitionId: null,
        signals: signals.map((signal) => ({
          signal,
          sourceLane: message.lane,
          sourceQuery,
          observedListedNum: product.listedCount,
        })),
      });

      if (outcome === 'cap-reached') {
        capReachedMidPage = true;
        break;
      }

      if (outcome === 'created') newPidsAdmitted += 1;
      signalsRecorded += signals.length;
    }

    if (capReachedMidPage) {
      // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
      await recordDiscoveryFailure(db, {
        scope: 'DISCOVERY_CURATED_LANE',
        referenceId: `${connection.id}:${message.lane}`,
        errorCode: 'NEW_PID_CAP_REACHED',
        detail:
          'New-PID ceiling reached mid-page; lane parked at its current cursor.',
      });
      // eslint-disable-next-line no-await-in-loop -- terminal for this invocation.
      await pauseAndRetry(lease, {
        supplierConnectionId: connection.id,
        reason: 'NEW_PID_CAP_REACHED',
        consumeAttempt: false,
        delaySeconds: BUDGET_RETRY_DELAY_SECONDS * 4,
      });
      return;
    }

    pagesFetched += 1;
    nextPage += 1;

    if (nextPage > page.totalPages) {
      exhaustedProviderPages = true;
      break;
    }
  }

  // The run is over when the provider has no further pages or the lane hit
  // its own bounded page budget. Otherwise it continues from `nextPage` in a
  // successor message, so no single invocation runs long or unbounded.
  const runComplete =
    exhaustedProviderPages || pagesFetched >= CURATED_MAX_PAGES;

  await advanceCuratedLane(db, {
    supplierConnectionId: connection.id,
    lane: message.lane,
    leaseToken: lease.leaseToken,
    nextPage,
    pagesFetched,
    newPidsAdmitted,
    signalsRecorded,
    windowFromMs,
    windowToMs,
    finished: runComplete,
    releaseLease: true,
    // A completed run means this lane can contribute nothing more to the
    // CURRENT wave, which is what releases the intake floor to the next lane
    // down and eventually to the partition scanner. Recorded against the wave
    // edge, so the next wave retries the lane from page 1 - new products appear
    // between waves. A run that merely paused leaves the mark untouched.
    ...(runComplete && currentWaveLimit !== null
      ? { exhaustedAtWaveLimit: currentWaveLimit }
      : {}),
  });

  // Continue this run immediately, or schedule the next low-priority sweep.
  await insertOutboxIntents(getDb(), [
    curatedLaneIntent({
      supplierConnectionId: connection.id,
      lane: message.lane,
      // The mid-run key must carry the run's own window, not just the page
      // number. `advanceCuratedLane` resets `nextPage` to 1 when a run
      // finishes, so every sweep walks the same page numbers again - and
      // `work_outbox.idempotency_key` is uniquely indexed with no pruning, so
      // a bare `page:4` is consumed for good by the first run. Without the
      // window the second and every later sweep would enqueue an
      // already-used key, `onConflictDoNothing` would drop it, and the lane
      // would silently stall after its first invocation instead of walking up
      // to `CURATED_MAX_PAGES`.
      keySuffix: runComplete
        ? `sweep:${sweepWindowKey() + 1}`
        : `page:${sweepWindowKey()}:${nextPage}`,
      delaySeconds: runComplete ? CURATED_SWEEP_DELAY_SECONDS : undefined,
    }),
  ]);
}
