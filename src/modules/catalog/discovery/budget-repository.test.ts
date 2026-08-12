import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { fakeDb, lastCallArgs } from '../../../../test/fake-db';
import {
  assessBackgroundBudget,
  recordPointsInfo,
  tryAcquireRequestSlot,
} from './budget-repository';
import {
  BACKGROUND_POINTS_MAX_PERCENT,
  POINTS_DAILY_PLANNING_TOTAL,
} from './config';

const dialect = new PgDialect();

function budgetRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'budget-1',
    supplierConnectionId: 'connection-1',
    lastRequestAt: null,
    pointsTotal: 50_000,
    pointsUsedToday: 0,
    pointsRemaining: 50_000,
    pointsObservedAt: new Date(),
    pausedUntil: null,
    observedSubscriptionLimit: null,
    stateVersion: 1,
    ...overrides,
  };
}

describe('tryAcquireRequestSlot - the shared database-backed limiter', () => {
  it('wins the slot through one atomic conditional update - the database arbitrates concurrent workers', async () => {
    const { db, calls } = fakeDb([[{ id: 'budget-1' }]]);

    await expect(tryAcquireRequestSlot(db, 'connection-1')).resolves.toBe(true);

    const rendered = dialect.sqlToQuery(lastCallArgs(calls, 'where')[0] as SQL);
    // The claim carries the spacing AND pause predicates in the same WHERE,
    // so two workers can never both satisfy it inside one interval.
    expect(rendered.sql).toContain('"last_request_at"');
    expect(rendered.sql).toContain('"paused_until"');
  });

  it('loses the slot when the conditional update matches nothing (another worker inside the interval)', async () => {
    const { db } = fakeDb([[]]);

    await expect(tryAcquireRequestSlot(db, 'connection-1')).resolves.toBe(
      false,
    );
  });
});

describe('assessBackgroundBudget - points exhaustion and the priority reserve', () => {
  it('allows background work while the reserve holds', async () => {
    const { db } = fakeDb([[budgetRow()]]);

    await expect(
      assessBackgroundBudget(db, {
        supplierConnectionId: 'connection-1',
        requiredPoints: 50,
      }),
    ).resolves.toEqual({ allowed: true });
  });

  it('refuses once spending would dip into the reserved share, using minute refill instead of parking until midnight', async () => {
    const total = 50_000;
    const reserve = Math.ceil(
      (total * (100 - BACKGROUND_POINTS_MAX_PERCENT)) / 100,
    );
    const { db } = fakeDb([
      [budgetRow({ pointsTotal: total, pointsRemaining: reserve + 10 })],
    ]);

    const result = await assessBackgroundBudget(db, {
      supplierConnectionId: 'connection-1',
      requiredPoints: 50,
    });

    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.reason).toBe('POINTS_RESERVE');
    expect(result.retryAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.retryAt.getTime()).toBeLessThan(Date.now() + 60 * 60 * 1000);
  });

  it('honors a 429 pause window with a delayed retry, never an aggressive retry', async () => {
    const pausedUntil = new Date(Date.now() + 15 * 60 * 1000);
    const { db } = fakeDb([[budgetRow({ pausedUntil })]]);

    const result = await assessBackgroundBudget(db, {
      supplierConnectionId: 'connection-1',
      requiredPoints: 50,
    });

    expect(result.allowed).toBe(false);
    if (result.allowed) return;
    expect(result.reason).toBe('PAUSED');
    expect(result.retryAt).toEqual(pausedUntil);
  });

  it('ignores an exhausted reading taken before the last reset, so the ledger can never deadlock itself', async () => {
    // Every path that could refresh the ledger gates on this function first.
    // If a pre-reset "almost exhausted" reading were trusted, it would
    // refuse the very calls whose responses would correct it, and nothing
    // would recover until someone intervened by hand.
    const total = 56_107;
    const reserve = Math.ceil(
      (total * (100 - BACKGROUND_POINTS_MAX_PERCENT)) / 100,
    );
    const beforeLastReset = new Date();
    beforeLastReset.setUTCHours(-1, 0, 0, 0);

    const { db } = fakeDb([
      [
        budgetRow({
          pointsTotal: total,
          pointsRemaining: reserve,
          pointsObservedAt: beforeLastReset,
        }),
      ],
    ]);

    await expect(
      assessBackgroundBudget(db, {
        supplierConnectionId: 'connection-1',
        requiredPoints: 20,
      }),
    ).resolves.toEqual({ allowed: true });
  });

  it('still refuses an exhausted reading taken since the last reset', async () => {
    const total = 56_107;
    const reserve = Math.ceil(
      (total * (100 - BACKGROUND_POINTS_MAX_PERCENT)) / 100,
    );
    const sinceLastReset = new Date();
    sinceLastReset.setUTCHours(sinceLastReset.getUTCHours(), 0, 0, 0);

    const { db } = fakeDb([
      [
        budgetRow({
          pointsTotal: total,
          pointsRemaining: reserve,
          pointsObservedAt: sinceLastReset,
        }),
      ],
    ]);

    const result = await assessBackgroundBudget(db, {
      supplierConnectionId: 'connection-1',
      requiredPoints: 20,
    });

    expect(result.allowed).toBe(false);
  });

  it('treats a stored zero total as "never observed", not as an empty quota', async () => {
    // Defence in depth against the same zero-quota trap: `?? PLANNING_TOTAL`
    // does not catch 0, so a 0 total would make the reserve 0 and refuse
    // every request forever. A non-positive total means no real quota has
    // been observed, exactly like null.
    const { db } = fakeDb([
      [budgetRow({ pointsTotal: 0, pointsRemaining: 40_000 })],
    ]);

    await expect(
      assessBackgroundBudget(db, {
        supplierConnectionId: 'connection-1',
        requiredPoints: 20,
      }),
    ).resolves.toEqual({ allowed: true });
  });

  it('lets bootstrap proceed before any real pointsInfo was observed (planning assumption)', async () => {
    const { db } = fakeDb([
      [budgetRow({ pointsTotal: null, pointsRemaining: null })],
    ]);

    await expect(
      assessBackgroundBudget(db, {
        supplierConnectionId: 'connection-1',
        requiredPoints: POINTS_DAILY_PLANNING_TOTAL / 1000,
      }),
    ).resolves.toEqual({ allowed: true });
  });
});

describe('recordPointsInfo', () => {
  it('persists the provider-reported quota exactly - observed, never invented', async () => {
    const { db, calls } = fakeDb([[]]);

    await recordPointsInfo(db, 'connection-1', {
      total: 56_107,
      usedToday: 50_110,
      remaining: 51_559,
    });

    const set = lastCallArgs(calls, 'set')[0] as Record<string, unknown>;
    expect(set.pointsTotal).toBe(56_107);
    expect(set.pointsUsedToday).toBe(50_110);
    expect(set.pointsRemaining).toBe(51_559);
  });

  it('is a no-op when the response carried no pointsInfo', async () => {
    const { db, calls } = fakeDb([[]]);

    await recordPointsInfo(db, 'connection-1', null);

    expect(calls).toHaveLength(0);
  });

  it('ignores the all-zero quota that a points-free endpoint reports', async () => {
    // Verified live 2026-08-11: /product/productComments is outside the
    // points system and answers {total: 0, usedToday: 0, remaining: 0}
    // rather than omitting pointsInfo. Since getCandidateEvidence calls
    // comments LAST, writing those zeros overwrote the real ledger on every
    // successful evidence fetch - and assessBackgroundBudget then refused
    // all background work until the next UTC midnight.
    const { db, calls } = fakeDb([[]]);

    await recordPointsInfo(db, 'connection-1', {
      total: 0,
      usedToday: 0,
      remaining: 0,
    });

    expect(calls).toHaveLength(0);
  });
});
