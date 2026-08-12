import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import {
  supplierRequestBudgets,
  type SupplierRequestBudgetRow,
} from '@/lib/db/schema';
import type { CjPointsInfo } from '@/lib/cj/primitives';
import {
  BACKGROUND_POINTS_MAX_PERCENT,
  lastUtcMidnight,
  POINTS_DAILY_PLANNING_TOTAL,
  REQUEST_MIN_INTERVAL_MS,
} from './config';

/**
 * Database-backed shared request limiter and points budget per connection
 * (ADR-013 §5). Concurrent serverless workers all gate through the same row
 * with atomic conditional updates, so the fleet as a whole cannot exceed the
 * configured request rate (default one request per second - the documented
 * lowest account tier - until the real tier is verified) or dip into the
 * points reserve held for selected/live/order-critical work.
 */

export async function ensureBudgetRow(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<void> {
  await executor
    .insert(supplierRequestBudgets)
    .values({ supplierConnectionId })
    .onConflictDoNothing({
      target: supplierRequestBudgets.supplierConnectionId,
    });
}

export async function findBudgetRow(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<SupplierRequestBudgetRow | null> {
  const rows = await executor
    .select()
    .from(supplierRequestBudgets)
    .where(
      eq(supplierRequestBudgets.supplierConnectionId, supplierConnectionId),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * Atomically claims one supplier request slot: succeeds only when at least
 * `REQUEST_MIN_INTERVAL_MS` has passed since the previous granted slot and
 * the budget is not paused. One conditional UPDATE - the database is the
 * arbiter, so two concurrent workers can never both win the same slot.
 */
export async function tryAcquireRequestSlot(
  executor: DbExecutor,
  supplierConnectionId: string,
): Promise<boolean> {
  const now = new Date();
  const updated = await executor
    .update(supplierRequestBudgets)
    .set({ lastRequestAt: now, updatedAt: now })
    .where(
      and(
        eq(supplierRequestBudgets.supplierConnectionId, supplierConnectionId),
        or(
          isNull(supplierRequestBudgets.lastRequestAt),
          lte(
            supplierRequestBudgets.lastRequestAt,
            new Date(now.getTime() - REQUEST_MIN_INTERVAL_MS),
          ),
        ),
        or(
          isNull(supplierRequestBudgets.pausedUntil),
          lte(supplierRequestBudgets.pausedUntil, now),
        ),
      ),
    )
    .returning({ id: supplierRequestBudgets.id });

  return updated.length > 0;
}

export type BudgetAssessment =
  | { allowed: true }
  | { allowed: false; reason: 'PAUSED' | 'POINTS_RESERVE'; retryAt: Date };

const SAFETY_MARGIN_POINTS = 10;

function nextRefillAt(input: {
  total: number;
  remaining: number;
  requiredPoints: number;
  reserve: number;
  now: Date;
}): Date {
  const needed =
    input.reserve +
    input.requiredPoints +
    SAFETY_MARGIN_POINTS -
    input.remaining;
  const refillPerMinute = Math.max(1, input.total / 1_440);
  const minutes = Math.max(1, Math.ceil(needed / refillPerMinute));

  return new Date(input.now.getTime() + minutes * 60_000);
}

/**
 * Whether BACKGROUND work may spend `requiredPoints` now. Background
 * discovery/evaluation may consume at most `BACKGROUND_POINTS_MAX_PERCENT`
 * of the currently known available points; the remainder stays reserved for
 * selected/live/order-critical work. Before any real `pointsInfo` has been
 * observed the documented planning assumption applies (bootstrap must be
 * able to make its first call, which is also what populates the ledger).
 */
export async function assessBackgroundBudget(
  executor: DbExecutor,
  input: { supplierConnectionId: string; requiredPoints: number },
): Promise<BudgetAssessment> {
  const row = await findBudgetRow(executor, input.supplierConnectionId);
  const now = new Date();

  if (row === null) return { allowed: true };

  if (row.pausedUntil !== null && row.pausedUntil > now) {
    return { allowed: false, reason: 'PAUSED', retryAt: row.pausedUntil };
  }

  // A stored total of 0 is not a real quota - it means no meaningful
  // `pointsInfo` has been observed. `??` alone would let that 0 through and
  // make the reserve 0 and every comparison fail closed forever, so the
  // planning assumption applies to a non-positive total exactly as it does
  // to a null one.
  const total =
    row.pointsTotal === null || row.pointsTotal <= 0
      ? POINTS_DAILY_PLANNING_TOTAL
      : row.pointsTotal;
  const reserve = Math.ceil(
    (total * (100 - BACKGROUND_POINTS_MAX_PERCENT)) / 100,
  );

  // An observation taken before the most recent 00:00 UTC reset describes
  // YESTERDAY's allowance. Trusting it is not merely inaccurate, it
  // deadlocks: every path that could refresh the ledger gates on this
  // function first, so a stale "almost exhausted" reading refuses the very
  // calls whose responses would correct it, and nothing recovers on its
  // own. Treating a pre-reset observation as unknown restores the
  // bootstrap behaviour - make the first call, let its real `pointsInfo`
  // repopulate the ledger - once per day, automatically.
  const observedAt = row.pointsObservedAt;
  const remaining =
    observedAt === null || observedAt < lastUtcMidnight(now)
      ? null
      : row.pointsRemaining;

  if (remaining !== null && remaining - input.requiredPoints < reserve) {
    return {
      allowed: false,
      reason: 'POINTS_RESERVE',
      retryAt: nextRefillAt({
        total,
        remaining,
        requiredPoints: input.requiredPoints,
        reserve,
        now,
      }),
    };
  }

  return { allowed: true };
}

/**
 * Persists provider-reported quota state from one real response.
 *
 * Ignores a report whose `total` is missing or non-positive. Verified live
 * 2026-08-11: CJ attaches `pointsInfo` to EVERY response, but endpoints that
 * are outside the points system - `/product/productComments`, which the
 * documented cost table does not list - return `{total: 0, usedToday: 0,
 * remaining: 0}` rather than omitting it. Those zeros are "this endpoint has
 * no quota to report", never "the account has no points left".
 *
 * Writing them was actively harmful. `getCandidateEvidence` calls comments
 * LAST, so every successful evidence fetch overwrote the ledger with zeros;
 * `assessBackgroundBudget` then read `remaining = 0` and refused all further
 * background work until the next UTC midnight. One completed evaluation
 * would park every candidate behind it.
 */
export async function recordPointsInfo(
  executor: DbExecutor,
  supplierConnectionId: string,
  pointsInfo: CjPointsInfo,
): Promise<void> {
  if (pointsInfo === null || pointsInfo === undefined) return;
  if (pointsInfo.total === null || pointsInfo.total <= 0) return;

  await executor
    .update(supplierRequestBudgets)
    .set({
      pointsTotal:
        pointsInfo.total === null ? null : Math.trunc(pointsInfo.total),
      pointsUsedToday:
        pointsInfo.usedToday === null ? null : Math.trunc(pointsInfo.usedToday),
      pointsRemaining:
        pointsInfo.remaining === null ? null : Math.trunc(pointsInfo.remaining),
      pointsObservedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      eq(supplierRequestBudgets.supplierConnectionId, supplierConnectionId),
    );
}

/**
 * HTTP 429 handling: stop aggressive retries and pause this connection's
 * background supplier work until the given instant (aligned with documented
 * refill/reset behavior). The worker never sleeps a function alive waiting
 * for this - it persists a delayed queue continuation instead.
 */
export async function recordRateLimitPause(
  executor: DbExecutor,
  supplierConnectionId: string,
  pausedUntil: Date,
): Promise<void> {
  await executor
    .update(supplierRequestBudgets)
    .set({
      pausedUntil,
      providerPauseReason: 'HTTP_429',
      nextSafeRefillAt: pausedUntil,
      stateVersion: sql`${supplierRequestBudgets.stateVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      eq(supplierRequestBudgets.supplierConnectionId, supplierConnectionId),
    );
}
