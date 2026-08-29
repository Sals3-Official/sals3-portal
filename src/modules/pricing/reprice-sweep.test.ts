// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { planRepriceMock } = vi.hoisted(() => ({ planRepriceMock: vi.fn() }));

vi.mock('./reprice', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./reprice')>()),
  planReprice: planRepriceMock,
}));

/* eslint-disable import/first */
import { runRepriceSweep, SWEEP_START, type SweepScope } from './reprice-sweep';

/**
 * The sweep exists because the reviewed dialog cannot *finish* a catalogue —
 * every department across every destination, several pages deep, is hundreds of
 * clicks for a job with no judgement in it. What it must never become is the
 * unscoped run the dialog had removed: these fix the position handling, because
 * every way this goes wrong ends the same way — a page silently skipped, and a
 * report that says everything matches.
 */

const SCOPES: SweepScope[] = [
  { sellerAccountId: 'seller-a', categoryCode: 'CAT-1', marketCode: 'AU' },
  { sellerAccountId: 'seller-a', categoryCode: 'CAT-1', marketCode: 'PH' },
  { sellerAccountId: 'seller-a', categoryCode: 'CAT-2', marketCode: 'AU' },
];

function plan(overrides: Record<string, unknown> = {}) {
  return {
    lines: [],
    counts: { changed: 0, unchanged: 3, unpriceable: 0, manual: 0 },
    truncated: false,
    candidateCount: 3,
    nextAfterSku: null,
    fingerprint: '0-x',
    ...overrides,
  };
}

/** Never advances the clock, so the budget never expires unless a test says so. */
const frozenClock = () => 0;

function options(overrides: Record<string, unknown> = {}) {
  return {
    apply: true,
    reclaimSellerPriced: false,
    position: SWEEP_START,
    budgetMs: 1_000,
    write: vi.fn().mockResolvedValue({ ok: true, written: 1 }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  planRepriceMock.mockResolvedValue(plan());
});

describe('runRepriceSweep', () => {
  it('visits every scope and reports it finished', async () => {
    const result = await runRepriceSweep(
      {} as never,
      SCOPES,
      options(),
      frozenClock,
    );

    expect(result.done).toBe(true);
    expect(result.totals.scopesVisited).toBe(3);
    expect(planRepriceMock).toHaveBeenCalledTimes(3);
  });

  it('pages within a scope before moving to the next one', async () => {
    // Two pages of CAT-1/AU, then one each for the rest.
    planRepriceMock
      .mockResolvedValueOnce(
        plan({
          counts: { changed: 1, unchanged: 0, unpriceable: 0, manual: 0 },
          nextAfterSku: 'SKU-500',
        }),
      )
      .mockResolvedValue(plan());

    await runRepriceSweep({} as never, SCOPES, options(), frozenClock);

    expect(planRepriceMock).toHaveBeenCalledTimes(4);
    expect(planRepriceMock.mock.calls[1][2]).toEqual({
      categoryCode: 'CAT-1',
      marketCode: 'AU',
      afterSku: 'SKU-500',
    });
    // And the third call has moved on, with the position cleared.
    expect(planRepriceMock.mock.calls[2][2]).toEqual({
      categoryCode: 'CAT-1',
      marketCode: 'PH',
      afterSku: null,
    });
  });

  it('counts the pages it planned, so the run can be checked', async () => {
    /*
      Without this the run is unfalsifiable. `done: true` with `changed: 0`
      reads identically whether the sweep walked every page of a 500-offer scope
      or stopped at the first — and a report nobody can check is how the old
      "run it again afterwards to reach the rest" survived being wrong.
    */
    planRepriceMock
      .mockResolvedValueOnce(
        plan({
          counts: { changed: 1, unchanged: 0, unpriceable: 0, manual: 0 },
          nextAfterSku: 'SKU-500',
        }),
      )
      .mockResolvedValueOnce(
        plan({
          counts: { changed: 1, unchanged: 0, unpriceable: 0, manual: 0 },
          nextAfterSku: 'SKU-999',
        }),
      )
      .mockResolvedValue(plan());

    const result = await runRepriceSweep(
      {} as never,
      SCOPES,
      options(),
      frozenClock,
    );

    // Three pages for the first scope, one each for the other two.
    expect(result.totals.pagesVisited).toBe(5);
    expect(result.totals.scopesVisited).toBe(3);
    // One scope needed continuing, not three pages' worth of scopes.
    expect(result.totals.scopesPaged).toBe(1);
  });

  it('reports no paging when every scope fits in one page', async () => {
    // The number that makes the one above meaningful: if it were always
    // non-zero it would say nothing about whether paging engaged.
    const result = await runRepriceSweep(
      {} as never,
      SCOPES,
      options(),
      frozenClock,
    );

    expect(result.totals.pagesVisited).toBe(3);
    expect(result.totals.scopesPaged).toBe(0);
  });

  it('never advances within a scope on a dry run', async () => {
    /*
      The failure this prevents: a plan-only pass that walked page two would
      report it as covered while page one still holds whatever it holds. A dry
      run reads the first page of every scope, which makes `changed` a lower
      bound rather than a wrong number.
    */
    planRepriceMock.mockResolvedValue(
      plan({
        counts: { changed: 9, unchanged: 0, unpriceable: 0, manual: 0 },
        nextAfterSku: 'SKU-500',
      }),
    );

    const write = vi.fn();
    const result = await runRepriceSweep(
      {} as never,
      SCOPES,
      options({ apply: false, write }),
      frozenClock,
    );

    expect(write).not.toHaveBeenCalled();
    expect(planRepriceMock).toHaveBeenCalledTimes(3);
    expect(result.done).toBe(true);
    expect(result.totals.changed).toBe(27);
    expect(result.totals.written).toBe(0);
  });

  it('stops on its budget and hands back where it was', async () => {
    let clock = 0;
    const ticking = () => {
      clock += 400;

      return clock;
    };

    const result = await runRepriceSweep(
      {} as never,
      SCOPES,
      options({ budgetMs: 500 }),
      ticking,
    );

    expect(result.done).toBe(false);
    expect(result.position.scopeIndex).toBeLessThan(SCOPES.length);
    // The next call resumes at a scope, not part-way through one it finished.
    expect(result.position.afterSku).toBeNull();
  });

  it('resumes from a handed-back position rather than restarting', async () => {
    const result = await runRepriceSweep(
      {} as never,
      SCOPES,
      options({ position: { scopeIndex: 2, afterSku: 'SKU-123' } }),
      frozenClock,
    );

    expect(planRepriceMock).toHaveBeenCalledTimes(1);
    expect(planRepriceMock.mock.calls[0][1]).toBe('seller-a');
    expect(planRepriceMock.mock.calls[0][2]).toEqual({
      categoryCode: 'CAT-2',
      marketCode: 'AU',
      afterSku: 'SKU-123',
    });
    expect(result.done).toBe(true);
  });

  it('stops rather than continuing past a version conflict', async () => {
    /*
      A conflict means an offer moved between the plan and the write — a
      publish, or somebody in the dialog at the same time. The position is still
      the last page that committed, so a re-run picks up cleanly; carrying on
      would plan the rest against a catalogue that just changed underneath it.
    */
    planRepriceMock.mockResolvedValue(
      plan({ counts: { changed: 1, unchanged: 0, unpriceable: 0, manual: 0 } }),
    );
    const write = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, written: 1 })
      .mockResolvedValueOnce({ ok: false, reason: 'version_conflict' });

    const result = await runRepriceSweep(
      {} as never,
      SCOPES,
      options({ write }),
      frozenClock,
    );

    expect(result.done).toBe(false);
    expect(result.position.scopeIndex).toBe(1);
    expect(result.totals.written).toBe(1);
    expect(planRepriceMock).toHaveBeenCalledTimes(2);
  });

  it('writes each page under the seller that owns it', async () => {
    // The scope list spans sellers. Writing one seller's page under another's
    // id would put the wrong account on every audit row it produced.
    planRepriceMock.mockResolvedValue(
      plan({ counts: { changed: 1, unchanged: 0, unpriceable: 0, manual: 0 } }),
    );
    const write = vi.fn().mockResolvedValue({ ok: true, written: 1 });

    await runRepriceSweep(
      {} as never,
      [
        {
          sellerAccountId: 'seller-a',
          categoryCode: 'CAT-1',
          marketCode: 'AU',
        },
        {
          sellerAccountId: 'seller-b',
          categoryCode: 'CAT-1',
          marketCode: 'AU',
        },
      ],
      options({ write }),
      frozenClock,
    );

    expect(write.mock.calls[0][0]).toBe('seller-a');
    expect(write.mock.calls[1][0]).toBe('seller-b');
  });

  it('leaves hand-typed prices alone unless the caller asked', async () => {
    // The flag overwrites human decisions and `product_offers` keeps no
    // history. A seller approving the dialog has read that department; nobody
    // reads a sweep.
    await runRepriceSweep({} as never, SCOPES, options(), frozenClock);

    expect(planRepriceMock.mock.calls[0][3]).toEqual({
      reclaimSellerPriced: false,
    });
  });

  it('an empty scope list is finished, not stuck', async () => {
    const result = await runRepriceSweep(
      {} as never,
      [],
      options(),
      frozenClock,
    );

    expect(result.done).toBe(true);
    expect(result.scopeCount).toBe(0);
    expect(planRepriceMock).not.toHaveBeenCalled();
  });
});
