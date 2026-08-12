import { and, eq, gt, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import {
  candidateEvaluations,
  discoveryBacklogGates,
  discoveryPidCapacities,
  supplierCandidates,
  type CuratedLane,
  type DiscoveryBacklogGateRow,
  type DiscoveryPidCapacityRow,
} from '@/lib/db/schema';
import { MAX_EVALUATION_ATTEMPTS } from '../candidates/rules/policy';
import { newDiscoveryWaveSize } from './config';
import { CURATED_LANES } from './curated-lanes';
import { listEligibleCuratedLanes } from './curated-lane-repository';

/**
 * The two durable intake controls every CJ discovery lane must clear before
 * it may make a new broad `product/list` request:
 *
 * 1. the ONE-TIME existing-backlog drain gate, and
 * 2. the rolling new-unique-PID wave ledger (owner wave size, default 600).
 *
 * Both live in PostgreSQL rather than process memory on purpose. Vercel
 * restarts, at-least-once queue redelivery, and concurrent workers must all
 * observe the same state, and the PID wave in particular must be
 * impossible to overshoot by racing - which is why capacity is consumed by a
 * conditional UPDATE inside the same transaction that inserts the candidate,
 * never by a read-then-write in application code.
 */

// --- Backlog gate ---------------------------------------------------------------

/**
 * What counts as ACTIONABLE backlog: Candidate Pipeline work that existed at
 * the gate's immutable activation cutoff AND is still in-flight or retryable
 * under the new lean policy.
 *
 * Deliberately excluded, because they are already resolved and would
 * otherwise deadlock discovery forever on historical rows:
 *
 * - `PASS` / `PASS_WITH_ATTENTION` / `BLOCKED` - decided;
 * - `TEMPORARILY_INELIGIBLE` with no `nextRetryAt` - a settled policy
 *   decision (for example `NO_VALID_MARKET`), which re-opens on a policy
 *   change event, not on a clock;
 * - `EVALUATION_FAILED` at or past `MAX_EVALUATION_ATTEMPTS` - a dead letter
 *   that belongs to the Exception Queue and a person, not to this gate.
 */
function activeEvaluationCondition() {
  return or(
    eq(candidateEvaluations.status, 'QUEUED'),
    eq(candidateEvaluations.status, 'EVALUATING'),
    and(
      eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
      lt(candidateEvaluations.attemptCount, MAX_EVALUATION_ATTEMPTS),
    ),
    and(
      eq(candidateEvaluations.status, 'TEMPORARILY_INELIGIBLE'),
      isNotNull(candidateEvaluations.nextRetryAt),
    ),
  );
}

function actionableBacklogCondition(activationAt: Date) {
  return and(
    lte(supplierCandidates.createdAt, activationAt),
    activeEvaluationCondition(),
  );
}

export async function countActiveEvaluationWork(
  executor: DbExecutor,
  supplierConnectionId: string,
  /**
   * Count only work created after this instant. The wave gate passes the
   * backlog gate's `activationAt`, so a wave waits for the products IT
   * admitted and never for the historical pipeline: an unbounded count made
   * every wave after the first hostage to rows discovered before lean intake
   * existed. Omit to count everything.
   */
  createdAfter?: Date,
): Promise<number> {
  const rows = await executor
    .select({ total: sql<number>`count(*)` })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .where(
      and(
        eq(supplierCandidates.supplierConnectionId, supplierConnectionId),
        createdAfter === undefined
          ? undefined
          : gt(supplierCandidates.createdAt, createdAfter),
        activeEvaluationCondition(),
      ),
    );

  return Number(rows[0]?.total ?? 0);
}

export async function countActionableBacklog(
  executor: DbExecutor,
  input: { supplierConnectionId: string; activationAt: Date },
): Promise<number> {
  const rows = await executor
    .select({ total: sql<number>`count(*)` })
    .from(candidateEvaluations)
    .innerJoin(
      supplierCandidates,
      eq(supplierCandidates.id, candidateEvaluations.candidateId),
    )
    .where(
      and(
        eq(supplierCandidates.supplierConnectionId, input.supplierConnectionId),
        actionableBacklogCondition(input.activationAt),
      ),
    );

  return Number(rows[0]?.total ?? 0);
}

/**
 * Candidate ids of actionable backlog rows, oldest first - the bounded batch
 * the drain re-screens locally. Never used to spend a supplier call.
 */
export async function listActionableBacklogCandidateIds(
  executor: DbExecutor,
  input: {
    supplierConnectionId: string;
    activationAt: Date;
    limit: number;
  },
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
        eq(supplierCandidates.supplierConnectionId, input.supplierConnectionId),
        actionableBacklogCondition(input.activationAt),
      ),
    )
    .orderBy(supplierCandidates.createdAt)
    .limit(Math.max(1, input.limit));

  return rows.map((row) => row.candidateId);
}

export async function findBacklogGate(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<DiscoveryBacklogGateRow | null> {
  const rows = await executor
    .select()
    .from(discoveryBacklogGates)
    .where(eq(discoveryBacklogGates.supplierConnectionId, supplierConnectionId))
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Creates the gate on first consultation, stamping an immutable activation
 * cutoff and the backlog observed at that instant. Create-or-nothing on the
 * connection unique index, so two concurrent first calls cannot produce two
 * cutoffs - the loser reads the winner's row.
 */
export async function ensureBacklogGate(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<DiscoveryBacklogGateRow> {
  const existing = await findBacklogGate(executor, supplierConnectionId);

  if (existing !== null) return existing;

  const activationAt = new Date();
  const baselineBacklogCount = await countActionableBacklog(executor, {
    supplierConnectionId,
    activationAt,
  });

  await executor
    .insert(discoveryBacklogGates)
    .values({
      supplierConnectionId,
      activationAt,
      baselineBacklogCount,
      lastObservedBacklog: baselineBacklogCount,
      lastEvaluatedAt: activationAt,
      // A connection with nothing in flight at activation has nothing to
      // drain; recording that immediately keeps the one-time transition
      // honest instead of pretending a drain happened later.
      state: baselineBacklogCount === 0 ? 'DRAIN_COMPLETE' : 'DRAINING',
      drainCompletedAt: baselineBacklogCount === 0 ? activationAt : null,
    })
    .onConflictDoNothing({
      target: discoveryBacklogGates.supplierConnectionId,
    });

  const created = await findBacklogGate(executor, supplierConnectionId);

  if (created === null) {
    throw new Error('Backlog gate could not be created or read back.');
  }

  return created;
}

/**
 * Records the observed backlog and, when it has reached zero, the ONE-TIME
 * completion. The compare-and-set requires the row to still be `DRAINING` at
 * the exact `stateVersion` the caller read, so a duplicate delivery cannot
 * complete the drain twice, and - critically - a completed gate can never be
 * moved back to `DRAINING` by this function or any other. New post-cutoff
 * candidates are outside the cutoff by construction and never re-arm it.
 */
export async function recordBacklogObservation(
  executor: DbExecutor,
  input: {
    supplierConnectionId: string;
    stateVersion: number;
    observedBacklog: number;
  },
): Promise<boolean> {
  const now = new Date();
  const drained = input.observedBacklog === 0;
  const updated = await executor
    .update(discoveryBacklogGates)
    .set({
      lastObservedBacklog: input.observedBacklog,
      lastEvaluatedAt: now,
      ...(drained
        ? { state: 'DRAIN_COMPLETE' as const, drainCompletedAt: now }
        : {}),
      stateVersion: sql`${discoveryBacklogGates.stateVersion} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(
          discoveryBacklogGates.supplierConnectionId,
          input.supplierConnectionId,
        ),
        eq(discoveryBacklogGates.stateVersion, input.stateVersion),
        eq(discoveryBacklogGates.state, 'DRAINING'),
      ),
    )
    .returning({ id: discoveryBacklogGates.id });

  return updated.length > 0;
}

// --- New-unique-PID capacity ledger ------------------------------------------------

export async function findPidCapacity(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<DiscoveryPidCapacityRow | null> {
  const rows = await executor
    .select()
    .from(discoveryPidCapacities)
    .where(
      eq(discoveryPidCapacities.supplierConnectionId, supplierConnectionId),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Creates the ledger when absent. Existing rows are not silently rewritten:
 * `limitValue` is the current wave edge and moves only when a wave drains.
 */
export async function ensurePidCapacity(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<DiscoveryPidCapacityRow> {
  const limitValue = newDiscoveryWaveSize();

  await executor
    .insert(discoveryPidCapacities)
    .values({ supplierConnectionId, limitValue })
    .onConflictDoNothing({
      target: discoveryPidCapacities.supplierConnectionId,
    });

  const row = await findPidCapacity(executor, supplierConnectionId);

  if (row === null) {
    throw new Error('PID capacity ledger could not be created or read back.');
  }

  return row;
}

/**
 * Opens the next rolling wave with a compare-and-set. This is separate from
 * `tryConsumeNewPidCapacity`: advancing the wave changes how many products
 * may be admitted, while consuming capacity accounts for one new PID.
 */
export async function advancePidCapacityWave(
  executor: DbExecutor,
  supplierConnectionId: string,
  input: { observedLimitValue: number; observedAdmittedCount: number },
): Promise<boolean> {
  const now = new Date();
  const updated = await executor
    .update(discoveryPidCapacities)
    .set({
      limitValue: input.observedAdmittedCount + newDiscoveryWaveSize(),
      capReachedAt: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(discoveryPidCapacities.supplierConnectionId, supplierConnectionId),
        eq(discoveryPidCapacities.limitValue, input.observedLimitValue),
        eq(discoveryPidCapacities.admittedCount, input.observedAdmittedCount),
      ),
    )
    .returning({ id: discoveryPidCapacities.id });

  return updated.length > 0;
}

/**
 * Atomically consumes ONE unit of new-PID capacity. The whole ceiling rests
 * on this single conditional UPDATE: the `admitted_count < limit_value`
 * predicate is evaluated by PostgreSQL under the row lock, so two concurrent
 * workers - or the same message delivered twice - can never both take the
 * last unit. Returns false when the ceiling is reached, and the caller must
 * then admit NOTHING for that product.
 *
 * Must be called inside the same transaction as the candidate insert. A
 * transaction that rolls back gives its unit straight back.
 */
export async function tryConsumeNewPidCapacity(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<boolean> {
  const now = new Date();
  const updated = await executor
    .update(discoveryPidCapacities)
    .set({
      admittedCount: sql`${discoveryPidCapacities.admittedCount} + 1`,
      lastAdmittedAt: now,
      // `now.toISOString()`, never the Date itself. A plain column assignment
      // (`lastAdmittedAt: now` above) serializes through the column's type
      // mapping, but a value interpolated into a raw `sql` template goes to
      // the driver as an untyped bind - and postgres.js throws
      // ERR_INVALID_ARG_TYPE on a raw Date there. This is exactly the first
      // statement a genuinely NEW product reaches, so the bug admitted
      // nothing while every fake-db test passed (mocks never serialize).
      // Production 2026-08-12: the whole ingest transaction rolled back on
      // this line, the queue redelivered forever, and the wave stayed at 0.
      capReachedAt: sql`CASE WHEN ${discoveryPidCapacities.admittedCount} + 1 >= ${discoveryPidCapacities.limitValue} THEN ${now.toISOString()} ELSE ${discoveryPidCapacities.capReachedAt} END`,
      updatedAt: now,
    })
    .where(
      and(
        eq(discoveryPidCapacities.supplierConnectionId, supplierConnectionId),
        sql`${discoveryPidCapacities.admittedCount} < ${discoveryPidCapacities.limitValue}`,
      ),
    )
    .returning({ id: discoveryPidCapacities.id });

  return updated.length > 0;
}

/**
 * Returns one consumed unit. Called only when a caller took capacity for what
 * it believed was a new PID and then lost the insert race to a concurrent
 * worker that admitted the same PID - without this, the ledger would count
 * one product twice and under-deliver the owner's ceiling. Guarded so it can
 * never take the count below zero.
 */
export async function releaseNewPidCapacity(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<void> {
  await executor
    .update(discoveryPidCapacities)
    .set({
      admittedCount: sql`${discoveryPidCapacities.admittedCount} - 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(discoveryPidCapacities.supplierConnectionId, supplierConnectionId),
        sql`${discoveryPidCapacities.admittedCount} > 0`,
      ),
    );
}

// --- Combined pre-flight assessment -------------------------------------------------

export type IntakeGateDecision =
  | {
      allowed: true;
      remainingCapacity: number;
      waveSize: number;
      currentWaveLimit: number;
      admittedCount: number;
      activeEvaluationWork: number;
    }
  | {
      allowed: false;
      /** Persisted verbatim as the visible pause reason. */
      reason:
        | 'BACKLOG_DRAIN_PENDING'
        | 'NEW_PID_WAVE_DRAIN_PENDING'
        | 'NEW_PID_CAP_REACHED'
        | 'HIGHER_PRIORITY_INTAKE_PENDING';
      /**
       * Which curated lane holds the intake floor, when that is the reason. The
       * failure record has to name it, or a parked partition looks like an
       * unexplained stall rather than a deliberate yield.
       */
      blockedBy?: CuratedLane;
      backlogCount: number;
      activeEvaluationWork: number;
      remainingCapacity: number;
      limitValue: number;
      waveSize: number;
      admittedCount: number;
    };

/**
 * The single pre-flight both broad and curated lanes call BEFORE any
 * `product/list` request. Backlog first, then wave capacity: a lane that
 * cannot fully ingest the page it is about to request does not request it,
 * which is what makes "never overshoot, never partially ingest" true by
 * construction rather than by cleanup afterwards.
 *
 * `requiredCapacity` is the bounded request's worst case - one page can bring
 * at most `pageSize` new PIDs - so a wave is reached exactly or safely
 * underfilled by less than one page, never exceeded. Once every active
 * evaluation settles, the next 600-product wave opens automatically.
 */
export async function assessIntakeGate(
  executor: DbExecutor,
  input: {
    supplierConnectionId: string;
    requiredCapacity: number;
    /**
     * Who is asking. Owner intake priority (2026-08-12) is strict:
     * `CJ_TRENDING`, then `CJ_MOST_LISTED`, then `CJ_NEW_ARRIVALS`, and the
     * coverage partition scanner last. A caller is refused while anything above
     * it can still contribute to the current wave.
     */
    intent: 'PARTITION' | CuratedLane;
  },
): Promise<IntakeGateDecision> {
  const waveSize = newDiscoveryWaveSize();
  const gate = await ensureBacklogGate(executor, input.supplierConnectionId);
  const capacity = await ensurePidCapacity(
    executor,
    input.supplierConnectionId,
  );
  const remainingCapacity = Math.max(
    0,
    capacity.limitValue - capacity.admittedCount,
  );

  if (gate.state !== 'DRAIN_COMPLETE') {
    const backlogCount = await countActionableBacklog(executor, {
      supplierConnectionId: input.supplierConnectionId,
      activationAt: gate.activationAt,
    });

    if (backlogCount > 0) {
      await recordBacklogObservation(executor, {
        supplierConnectionId: input.supplierConnectionId,
        stateVersion: gate.stateVersion,
        observedBacklog: backlogCount,
      });

      return {
        allowed: false,
        reason: 'BACKLOG_DRAIN_PENDING',
        backlogCount,
        activeEvaluationWork: backlogCount,
        remainingCapacity,
        limitValue: capacity.limitValue,
        waveSize,
        admittedCount: capacity.admittedCount,
      };
    }

    await recordBacklogObservation(executor, {
      supplierConnectionId: input.supplierConnectionId,
      stateVersion: gate.stateVersion,
      observedBacklog: 0,
    });
  }

  // Strict intake priority, checked before capacity so the lowest-priority
  // caller cannot trigger the wave advance and then lose the capacity it opened.
  //
  // `CURATED_LANES` is the ranking. A partition yields to every eligible lane; a
  // lane yields only to the lanes above it, so `CJ_TRENDING` is never refused
  // here and the order cannot deadlock. `CURATED_MAX_PAGES` is what guarantees a
  // lane eventually reports exhaustion and releases the floor.
  const eligibleLanes = await listEligibleCuratedLanes(executor, {
    supplierConnectionId: input.supplierConnectionId,
    waveLimit: capacity.limitValue,
  });
  const { intent } = input;
  const ownRank =
    intent === 'PARTITION'
      ? CURATED_LANES.length
      : CURATED_LANES.indexOf(intent);
  const blockingLanes = eligibleLanes
    .map((entry) => entry.lane)
    .filter((lane) => CURATED_LANES.indexOf(lane) < ownRank);

  if (blockingLanes.length > 0) {
    return {
      allowed: false,
      reason: 'HIGHER_PRIORITY_INTAKE_PENDING',
      blockedBy: blockingLanes[0],
      backlogCount: 0,
      activeEvaluationWork: 0,
      remainingCapacity,
      limitValue: capacity.limitValue,
      waveSize,
      admittedCount: capacity.admittedCount,
    };
  }

  if (remainingCapacity < input.requiredCapacity) {
    const activeEvaluationWork = await countActiveEvaluationWork(
      executor,
      input.supplierConnectionId,
      gate.activationAt,
    );

    if (activeEvaluationWork > 0) {
      return {
        allowed: false,
        reason: 'NEW_PID_WAVE_DRAIN_PENDING',
        backlogCount: 0,
        activeEvaluationWork,
        remainingCapacity,
        limitValue: capacity.limitValue,
        waveSize,
        admittedCount: capacity.admittedCount,
      };
    }

    await advancePidCapacityWave(executor, input.supplierConnectionId, {
      observedLimitValue: capacity.limitValue,
      observedAdmittedCount: capacity.admittedCount,
    });

    const advanced = await findPidCapacity(
      executor,
      input.supplierConnectionId,
    );
    const advancedRemaining =
      advanced === null
        ? 0
        : Math.max(0, advanced.limitValue - advanced.admittedCount);

    if (advanced !== null && advancedRemaining >= input.requiredCapacity) {
      return {
        allowed: true,
        remainingCapacity: advancedRemaining,
        waveSize,
        currentWaveLimit: advanced.limitValue,
        admittedCount: advanced.admittedCount,
        activeEvaluationWork,
      };
    }

    return {
      allowed: false,
      reason: 'NEW_PID_CAP_REACHED',
      backlogCount: 0,
      activeEvaluationWork,
      remainingCapacity: advancedRemaining,
      limitValue: advanced?.limitValue ?? capacity.limitValue,
      waveSize,
      admittedCount: advanced?.admittedCount ?? capacity.admittedCount,
    };
  }

  return {
    allowed: true,
    remainingCapacity,
    waveSize,
    currentWaveLimit: capacity.limitValue,
    admittedCount: capacity.admittedCount,
    activeEvaluationWork: 0,
  };
}

/** Status-endpoint read model. Never creates state - a pure observation. */
export async function readIntakeGateStatus(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<{
  backlog: {
    state: string;
    activationAt: string | null;
    baselineBacklogCount: number | null;
    actionableBacklogCount: number | null;
    drainCompletedAt: string | null;
  };
  newPidCapacity: {
    enabled: boolean;
    waveSize: number;
    currentWaveLimit: number | null;
    admittedCount: number | null;
    remainingInWave: number | null;
    activeEvaluationWork: number;
    capReachedAt: string | null;
  };
}> {
  const gate = await findBacklogGate(executor, supplierConnectionId);
  const capacity = await findPidCapacity(executor, supplierConnectionId);
  const activeEvaluationWork = await countActiveEvaluationWork(
    executor,
    supplierConnectionId,
  );
  const actionableBacklogCount =
    gate === null
      ? null
      : await countActionableBacklog(executor, {
          supplierConnectionId,
          activationAt: gate.activationAt,
        });

  return {
    backlog: {
      state: gate?.state ?? 'NOT_INITIALIZED',
      activationAt: gate?.activationAt.toISOString() ?? null,
      baselineBacklogCount: gate?.baselineBacklogCount ?? null,
      actionableBacklogCount,
      drainCompletedAt: gate?.drainCompletedAt?.toISOString() ?? null,
    },
    newPidCapacity: {
      // The ceiling is always in force. `enabled: false` only ever means the
      // ledger has not been created yet because this connection has never
      // been asked to discover anything.
      enabled: capacity !== null,
      waveSize: newDiscoveryWaveSize(),
      currentWaveLimit: capacity?.limitValue ?? null,
      admittedCount: capacity?.admittedCount ?? null,
      remainingInWave:
        capacity === null
          ? null
          : Math.max(0, capacity.limitValue - capacity.admittedCount),
      activeEvaluationWork,
      capReachedAt: capacity?.capReachedAt?.toISOString() ?? null,
    },
  };
}
