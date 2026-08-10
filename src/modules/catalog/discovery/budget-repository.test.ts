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

  it('refuses once spending would dip into the reserved share, with a retry at the documented UTC reset', async () => {
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
    expect(result.retryAt.getUTCHours()).toBe(0);
    expect(result.retryAt.getUTCMinutes()).toBe(0);
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
});
