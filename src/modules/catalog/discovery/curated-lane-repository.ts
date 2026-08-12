import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import {
  discoveryCuratedLanes,
  type CuratedLane,
  type DiscoveryCuratedLaneRow,
} from '@/lib/db/schema';
import { CURATED_LANE_LEASE_MS } from './config';
import { CURATED_LANES } from './curated-lanes';

/**
 * Durable state for the curated CJ lanes. Same lease/CAS discipline as
 * `partition-repository.ts`, and deliberately a separate table from
 * `discovery_partitions`: a curated lane is a subset by design, so it must be
 * structurally incapable of marking a partition COVERED, finishing a cycle,
 * or masking `PROVIDER_COVERAGE_UNRESOLVED`.
 */

export async function ensureCuratedLanes(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<void> {
  await executor
    .insert(discoveryCuratedLanes)
    .values(CURATED_LANES.map((lane) => ({ supplierConnectionId, lane })))
    .onConflictDoNothing({
      target: [
        discoveryCuratedLanes.supplierConnectionId,
        discoveryCuratedLanes.lane,
      ],
    });
}

export async function findCuratedLane(
  executor: DbExecutor,
  input: { supplierConnectionId: string; lane: CuratedLane },
): Promise<DiscoveryCuratedLaneRow | null> {
  const rows = await executor
    .select()
    .from(discoveryCuratedLanes)
    .where(
      and(
        eq(
          discoveryCuratedLanes.supplierConnectionId,
          input.supplierConnectionId,
        ),
        eq(discoveryCuratedLanes.lane, input.lane),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

export async function listCuratedLanes(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<DiscoveryCuratedLaneRow[]> {
  return executor
    .select()
    .from(discoveryCuratedLanes)
    .where(
      eq(discoveryCuratedLanes.supplierConnectionId, supplierConnectionId),
    );
}

export type CuratedLaneLease = {
  row: DiscoveryCuratedLaneRow;
  leaseToken: string;
};

/**
 * Exact lease: only the holder of an unexpired `(leaseToken, leasedUntil)`
 * may advance this lane. Two concurrent deliveries of the same lane message
 * cannot both fetch pages, so a duplicate delivery can never double-spend
 * supplier requests or new-PID capacity.
 */
export async function leaseCuratedLane(
  executor: DbExecutor,
  input: {
    supplierConnectionId: string;
    lane: CuratedLane;
    leaseToken: string;
  },
): Promise<CuratedLaneLease | null> {
  const now = new Date();
  const updated = await executor
    .update(discoveryCuratedLanes)
    .set({
      state: 'RUNNING',
      leaseToken: input.leaseToken,
      leasedUntil: new Date(now.getTime() + CURATED_LANE_LEASE_MS),
      lastRunAt: now,
      stateVersion: sql`${discoveryCuratedLanes.stateVersion} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(
          discoveryCuratedLanes.supplierConnectionId,
          input.supplierConnectionId,
        ),
        eq(discoveryCuratedLanes.lane, input.lane),
        or(
          isNull(discoveryCuratedLanes.leasedUntil),
          lte(discoveryCuratedLanes.leasedUntil, now),
        ),
      ),
    )
    .returning();

  const row = updated[0];

  return row === undefined ? null : { row, leaseToken: input.leaseToken };
}

/** Advances the resumable cursor. A pause never calls this. */
/**
 * The curated lanes that can still contribute to the current 600-PID wave, in
 * owner intake-priority order.
 *
 * Ranking comes from `CURATED_LANES`, which is already ordered
 * Trending -> Most listed -> New arrivals; restating that order anywhere else
 * would be a second source of truth for it.
 *
 * A lane is eligible unless it recorded exhaustion against THIS wave edge. A
 * row that does not exist yet is eligible too - `ensureCuratedLanes` creates it
 * on first run, and treating an absent row as exhausted would let the partition
 * scanner take the wave before any lane ever got a turn.
 */
export async function listEligibleCuratedLanes(
  executor: DbExecutor,
  input: { supplierConnectionId: string; waveLimit: number },
): Promise<CuratedLane[]> {
  const rows = await executor
    .select({
      lane: discoveryCuratedLanes.lane,
      exhaustedAtWaveLimit: discoveryCuratedLanes.exhaustedAtWaveLimit,
    })
    .from(discoveryCuratedLanes)
    .where(
      eq(
        discoveryCuratedLanes.supplierConnectionId,
        input.supplierConnectionId,
      ),
    );

  const exhausted = new Set(
    rows
      .filter((row) => row.exhaustedAtWaveLimit === input.waveLimit)
      .map((row) => row.lane),
  );

  return CURATED_LANES.filter((lane) => !exhausted.has(lane));
}

export async function advanceCuratedLane(
  executor: DbExecutor,
  input: {
    supplierConnectionId: string;
    lane: CuratedLane;
    leaseToken: string;
    nextPage: number;
    pagesFetched: number;
    newPidsAdmitted: number;
    signalsRecorded: number;
    windowFromMs?: number | null;
    windowToMs?: number | null;
    /** True when the lane finished its bounded run for this sweep. */
    finished: boolean;
    releaseLease: boolean;
    /**
     * The current wave edge when this lane can contribute nothing more to it,
     * `null` to make the lane eligible again, `undefined` to leave it as is.
     *
     * Recorded here rather than in a second statement so it lands in the same
     * compare-and-set as the finish it describes: a lane cannot be marked
     * exhausted by a worker that has already lost its lease.
     */
    exhaustedAtWaveLimit?: number | null;
  },
): Promise<boolean> {
  const now = new Date();
  const updated = await executor
    .update(discoveryCuratedLanes)
    .set({
      nextPage: input.finished ? 1 : input.nextPage,
      pagesFetched: input.finished ? 0 : input.pagesFetched,
      ...(input.exhaustedAtWaveLimit === undefined
        ? {}
        : { exhaustedAtWaveLimit: input.exhaustedAtWaveLimit }),
      newPidsAdmitted: sql`${discoveryCuratedLanes.newPidsAdmitted} + ${input.newPidsAdmitted}`,
      signalsRecorded: sql`${discoveryCuratedLanes.signalsRecorded} + ${input.signalsRecorded}`,
      ...(input.windowFromMs === undefined
        ? {}
        : { windowFromMs: input.windowFromMs }),
      ...(input.windowToMs === undefined
        ? {}
        : { windowToMs: input.windowToMs }),
      state: input.finished ? 'IDLE' : 'RUNNING',
      lastPauseReason: null,
      lastErrorCode: null,
      attempts: 0,
      ...(input.releaseLease ? { leaseToken: null, leasedUntil: null } : {}),
      stateVersion: sql`${discoveryCuratedLanes.stateVersion} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(
          discoveryCuratedLanes.supplierConnectionId,
          input.supplierConnectionId,
        ),
        eq(discoveryCuratedLanes.lane, input.lane),
        eq(discoveryCuratedLanes.leaseToken, input.leaseToken),
      ),
    )
    .returning({ id: discoveryCuratedLanes.id });

  return updated.length > 0;
}

/**
 * Records a visible pause WITHOUT advancing the cursor - the lane resumes at
 * exactly the page it was about to request. `reason` is surfaced verbatim in
 * the status endpoint, so it must name the real cause
 * (`BACKLOG_DRAIN_PENDING`, `NEW_PID_CAP_REACHED`, a budget code, ...).
 */
export async function pauseCuratedLane(
  executor: DbExecutor,
  input: {
    supplierConnectionId: string;
    lane: CuratedLane;
    leaseToken: string;
    reason: string;
    errorCode?: string;
    consumeAttempt?: boolean;
  },
): Promise<void> {
  const now = new Date();

  await executor
    .update(discoveryCuratedLanes)
    .set({
      state: 'PAUSED',
      lastPauseReason: input.reason,
      lastErrorCode: input.errorCode ?? null,
      ...(input.consumeAttempt === false
        ? {}
        : { attempts: sql`${discoveryCuratedLanes.attempts} + 1` }),
      leaseToken: null,
      leasedUntil: null,
      stateVersion: sql`${discoveryCuratedLanes.stateVersion} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(
          discoveryCuratedLanes.supplierConnectionId,
          input.supplierConnectionId,
        ),
        eq(discoveryCuratedLanes.lane, input.lane),
        eq(discoveryCuratedLanes.leaseToken, input.leaseToken),
      ),
    );
}
