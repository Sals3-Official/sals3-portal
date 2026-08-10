import { and, eq, isNull, lte, or, sql } from 'drizzle-orm';
import type { DbExecutor } from '@/lib/db/client';
import {
  supplierRequestBudgets,
  type SupplierRequestBudgetRow,
} from '@/lib/db/schema';
import type { CjPointsInfo } from '@/lib/cj/primitives';
import {
  BACKGROUND_POINTS_MAX_PERCENT,
  nextUtcMidnight,
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

  const total = row.pointsTotal ?? POINTS_DAILY_PLANNING_TOTAL;
  const reserve = Math.ceil(
    (total * (100 - BACKGROUND_POINTS_MAX_PERCENT)) / 100,
  );
  const remaining = row.pointsRemaining;

  if (remaining !== null && remaining - input.requiredPoints < reserve) {
    // The reserve is exhausted for today; documented reset is 00:00 UTC,
    // with per-minute replenishment before that - wait for the next window.
    return {
      allowed: false,
      reason: 'POINTS_RESERVE',
      retryAt: nextUtcMidnight(now),
    };
  }

  return { allowed: true };
}

/** Persists provider-reported quota state from one real response. */
export async function recordPointsInfo(
  executor: DbExecutor,
  supplierConnectionId: string,
  pointsInfo: CjPointsInfo,
): Promise<void> {
  if (pointsInfo === null || pointsInfo === undefined) return;

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
      stateVersion: sql`${supplierRequestBudgets.stateVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(
      eq(supplierRequestBudgets.supplierConnectionId, supplierConnectionId),
    );
}
