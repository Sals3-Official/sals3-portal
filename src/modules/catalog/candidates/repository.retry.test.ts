import { describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import {
  candidateEvaluations,
  supplierCandidates,
} from '@/lib/db/schema/catalog';
import { CONNECTION_PAUSE_ERROR_CODE_VALUES } from './connection-pause';
import { MAX_EVALUATION_ATTEMPTS } from './rules/policy';
import type { EvidenceSummary } from './rules/contracts';
import {
  recordEvaluationDecision,
  requeueConnectionPausedEvaluations,
} from './repository';

/** Chainable fake matching `repository.tenant-scope.test.ts`'s pattern. */
function fakeUpdateExecutor() {
  const setCalls: unknown[] = [];
  const whereCalls: unknown[] = [];
  const builder: Record<string, unknown> = {
    update: vi.fn(() => builder),
    set: vi.fn((arg: unknown) => {
      setCalls.push(arg);
      return builder;
    }),
    where: vi.fn((arg: unknown) => {
      whereCalls.push(arg);
      return Promise.resolve(undefined);
    }),
  };

  return { executor: builder as never, setCalls, whereCalls };
}

const EVIDENCE_SUMMARY = {} as EvidenceSummary;

describe('recordEvaluationDecision - retry-aware persistence', () => {
  it('schedules a real backoff for TEMPORARILY_INELIGIBLE, incrementing attemptCount', async () => {
    const { executor, setCalls } = fakeUpdateExecutor();

    await recordEvaluationDecision(executor, {
      candidateId: 'candidate-1',
      decision: { status: 'TEMPORARILY_INELIGIBLE', reasonCodes: ['NO_STOCK'] },
      evidenceSummary: EVIDENCE_SUMMARY,
      sourceSnapshotChecksum: 'checksum',
      policyVersion: 'v1',
      lastKnownPriceUsdCents: null,
      attemptCount: 2,
    });

    const set = setCalls[0] as {
      attemptCount: number;
      lastErrorCode: string | null;
      nextRetryAt: Date | null;
    };

    expect(set.attemptCount).toBe(3);
    expect(set.lastErrorCode).toBeNull();
    expect(set.nextRetryAt).toBeInstanceOf(Date);
    expect((set.nextRetryAt as Date).getTime()).toBeGreaterThan(Date.now());
  });

  it('stops scheduling a retry once TEMPORARILY_INELIGIBLE reaches the attempt cap', async () => {
    const { executor, setCalls } = fakeUpdateExecutor();

    await recordEvaluationDecision(executor, {
      candidateId: 'candidate-1',
      decision: { status: 'TEMPORARILY_INELIGIBLE', reasonCodes: ['NO_STOCK'] },
      evidenceSummary: EVIDENCE_SUMMARY,
      sourceSnapshotChecksum: 'checksum',
      policyVersion: 'v1',
      lastKnownPriceUsdCents: null,
      attemptCount: MAX_EVALUATION_ATTEMPTS - 1,
    });

    const set = setCalls[0] as { attemptCount: number; nextRetryAt: null };

    expect(set.attemptCount).toBe(MAX_EVALUATION_ATTEMPTS);
    expect(set.nextRetryAt).toBeNull();
  });

  it.each(['PASS', 'PASS_WITH_ATTENTION', 'BLOCKED'] as const)(
    'resets attemptCount to 0 and clears nextRetryAt for a %s decision, regardless of prior attemptCount',
    async (status) => {
      const { executor, setCalls } = fakeUpdateExecutor();

      await recordEvaluationDecision(executor, {
        candidateId: 'candidate-1',
        decision: { status, reasonCodes: [] },
        evidenceSummary: EVIDENCE_SUMMARY,
        sourceSnapshotChecksum: 'checksum',
        policyVersion: 'v1',
        lastKnownPriceUsdCents: null,
        attemptCount: 4,
      });

      const set = setCalls[0] as { attemptCount: number; nextRetryAt: null };

      expect(set.attemptCount).toBe(0);
      expect(set.nextRetryAt).toBeNull();
    },
  );
});

describe('requeueConnectionPausedEvaluations', () => {
  function fakeExecutor(selectRows: { id: string }[]) {
    const setCalls: unknown[] = [];
    const whereCalls: unknown[] = [];
    const builder: Record<string, unknown> = {
      select: vi.fn(() => builder),
      from: vi.fn(() => builder),
      innerJoin: vi.fn(() => builder),
      where: vi.fn((arg: unknown) => {
        whereCalls.push(arg);
        return builder;
      }),
      limit: vi.fn().mockResolvedValue(selectRows),
      update: vi.fn(() => builder),
      set: vi.fn((arg: unknown) => {
        setCalls.push(arg);
        return builder;
      }),
    };

    return { executor: builder as never, setCalls, whereCalls };
  }

  it('does nothing and returns 0 when no row is currently connection-paused', async () => {
    const { executor, setCalls } = fakeExecutor([]);

    await expect(
      requeueConnectionPausedEvaluations(executor, 'connection-1'),
    ).resolves.toBe(0);
    expect(setCalls).toHaveLength(0);
  });

  it('filters on this exact connection, EVALUATION_FAILED, and only the connection-pause error codes', async () => {
    const { executor, whereCalls } = fakeExecutor([]);

    await requeueConnectionPausedEvaluations(executor, 'connection-1');

    const expected = and(
      eq(supplierCandidates.supplierConnectionId, 'connection-1'),
      eq(candidateEvaluations.status, 'EVALUATION_FAILED'),
      inArray(candidateEvaluations.lastErrorCode, [
        ...CONNECTION_PAUSE_ERROR_CODE_VALUES,
      ]),
    );

    // Drizzle's `SQL` has no custom `toString()` (it always renders
    // "[object Object]"), so comparing `String(...)` directly would be
    // vacuous - render real SQL text via `PgDialect` instead, the same
    // pure, connection-free renderer Drizzle itself uses. `and()`'s TS
    // signature allows `undefined` only because it also accepts zero
    // conditions; both calls here pass three, so it is never actually
    // undefined at runtime - asserted explicitly rather than silenced.
    if (expected === undefined) {
      throw new Error('Expected a defined SQL condition, got undefined.');
    }

    const dialect = new PgDialect();
    const actualQuery = dialect.sqlToQuery(whereCalls[0] as SQL);
    const expectedQuery = dialect.sqlToQuery(expected);

    expect(actualQuery.sql).toBe(expectedQuery.sql);
    expect(actualQuery.params).toEqual(expectedQuery.params);
  });

  it('moves matched rows back to QUEUED with admissionReason CONNECTION_RESTORED, resetting all technical state', async () => {
    const { executor, setCalls } = fakeExecutor([
      { id: 'eval-1' },
      { id: 'eval-2' },
    ]);

    await expect(
      requeueConnectionPausedEvaluations(executor, 'connection-1'),
    ).resolves.toBe(2);

    expect(setCalls[0]).toMatchObject({
      status: 'QUEUED',
      admissionReason: 'CONNECTION_RESTORED',
      attemptCount: 0,
      lastErrorCode: null,
      nextRetryAt: null,
    });
  });

  it('respects the batch limit', async () => {
    const { executor } = fakeExecutor([{ id: 'eval-1' }]);
    const limitSpy = (executor as { limit: ReturnType<typeof vi.fn> }).limit;

    await requeueConnectionPausedEvaluations(executor, 'connection-1', 10);

    expect(limitSpy).toHaveBeenCalledWith(10);
  });
});
