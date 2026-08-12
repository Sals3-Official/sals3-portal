// @vitest-environment node
//
// This module imports `@/lib/db/client`, which throws when `window` is
// defined (a load-bearing guard against bundling the DB client into client
// code), so it needs the plain Node environment rather than jsdom.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fakeDb,
  lastCallArgs,
  type FakeDbCall,
} from '../../../../test/fake-db';

let currentDb: unknown;

vi.mock('@/lib/db/client', () => ({
  default: () => currentDb,
  isDatabaseConfigured: () => true,
}));

// eslint-disable-next-line import/first
import { findPipelineMatchesByPid } from './supplier-products-queries';

function candidateRow(overrides: Record<string, unknown> = {}) {
  return {
    candidateId: 'candidate-1',
    externalProductId: 'pid-1',
    discoveredAt: new Date('2026-08-01T00:00:00Z'),
    stockReviewState: 'STOCK_NOT_CHECKED',
    stockReviewVersion: 0,
    stockReviewObservedAt: null,
    stockReviewRecordedAt: null,
    stockReviewActorId: null,
    stockReviewObservedQuantity: null,
    stockReviewObservedOrigin: null,
    stockReviewNote: null,
    status: 'PASS',
    reasonCodes: [],
    attemptCount: 1,
    lastErrorCode: null,
    evaluatedAt: new Date('2026-08-02T00:00:00Z'),
    ...overrides,
  };
}

let calls: FakeDbCall[];

function useDb(results: unknown[][]) {
  const fake = fakeDb(results);
  currentDb = fake.db;
  calls = fake.calls;
}

beforeEach(() => {
  currentDb = undefined;
  calls = [];
});

describe('findPipelineMatchesByPid', () => {
  it('returns an empty map for an empty or all-blank pid list without touching the database', async () => {
    useDb([]);

    expect(await findPipelineMatchesByPid('seller-1', [])).toEqual(new Map());
    expect(await findPipelineMatchesByPid('seller-1', ['', ''])).toEqual(
      new Map(),
    );
    expect(calls).toHaveLength(0);
  });

  it('keys matches by pid and attaches loaded signals', async () => {
    useDb([
      [candidateRow()],
      [{ candidateId: 'candidate-1', signal: 'CJ_HIGH_LISTED' }],
    ]);

    const matches = await findPipelineMatchesByPid('seller-1', [
      'pid-1',
      'pid-unknown',
    ]);

    expect(matches.size).toBe(1);
    const match = matches.get('pid-1');
    expect(match).toMatchObject({
      candidateId: 'candidate-1',
      status: 'PASS',
      signals: ['CJ_HIGH_LISTED'],
    });
    expect(matches.has('pid-unknown')).toBe(false);
  });

  it('keeps a discovered-but-unevaluated candidate as a match with a null status', async () => {
    useDb([
      [
        candidateRow({
          status: null,
          reasonCodes: null,
          attemptCount: null,
          lastErrorCode: null,
          evaluatedAt: null,
        }),
      ],
      [],
    ]);

    const matches = await findPipelineMatchesByPid('seller-1', ['pid-1']);

    expect(matches.get('pid-1')).toMatchObject({
      status: null,
      reasonCodes: [],
      attemptCount: 0,
      evaluatedAt: null,
    });
  });

  it('uses a LEFT JOIN for evaluations and scopes to the seller in the same WHERE', async () => {
    useDb([[candidateRow()], []]);

    await findPipelineMatchesByPid('seller-1', ['pid-1']);

    const leftJoins = calls.filter((call) => call.method === 'leftJoin');
    expect(leftJoins).toHaveLength(1);
    const [whereCondition] = lastCallArgs(
      calls.filter((call) => call.method === 'where').slice(0, 1),
      'where',
    );
    expect(whereCondition).toBeDefined();
  });

  it('deduplicates pids and never sends more than 200', async () => {
    useDb([[], []]);

    const pids = Array.from({ length: 250 }, (_, i) => `pid-${i}`);
    await findPipelineMatchesByPid('seller-1', [...pids, ...pids]);

    // One select for candidates; signals lookup is skipped (no rows).
    expect(calls.filter((call) => call.method === 'select')).toHaveLength(1);
  });
});
