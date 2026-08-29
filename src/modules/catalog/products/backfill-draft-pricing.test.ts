// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import backfillDraftPricing, { BACKFILL_START } from './backfill-draft-pricing';

/**
 * The backlog exists because `create-draft.ts` prices with `UNMAPPED` and a null
 * category — hardcoded to decline — and nothing priced the offers afterwards.
 * `decide-category` does now, which fixes every product mapped from here on and
 * none of the ones mapped before it.
 *
 * Every way a backfill goes wrong ends the same way: a prefix covered, and a
 * report that says it finished.
 */

const dialect = new PgDialect();

function product(id: string) {
  return { productId: id, sellerAccountId: 'seller-a' };
}

/**
 * Answers each `selectDistinct` with the next batch in turn, and records the
 * `WHERE` it was given.
 *
 * `String(sqlObject)` renders `"[object Object]"` and would let the assertions
 * below pass vacuously — the dialect is the only thing that shows what Postgres
 * will receive.
 */
function fakeDb(batches: Array<Array<ReturnType<typeof product>>>) {
  const wheres: string[] = [];
  let call = -1;

  const builder: Record<string, unknown> = {};
  const self = (): unknown => builder;

  ['from', 'innerJoin', 'orderBy', 'limit'].forEach((name) => {
    builder[name] = vi.fn(self);
  });
  builder.where = vi.fn((condition: SQL | undefined) => {
    wheres.push(
      condition === undefined ? '' : dialect.sqlToQuery(condition).sql,
    );

    return builder;
  });
  builder.then = (resolve: (value: unknown) => unknown) =>
    resolve(batches[call] ?? []);

  return {
    executor: {
      selectDistinct: vi.fn(() => {
        call += 1;

        return builder;
      }),
    },
    wheres,
  };
}

const frozenClock = () => 0;

function options(overrides: Record<string, unknown> = {}) {
  return {
    position: BACKFILL_START,
    budgetMs: 1_000,
    actorId: 'system',
    price: vi.fn().mockResolvedValue({ resolved: 2, unresolved: 0 }),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('backfillDraftPricing', () => {
  it('prices every product it finds and reports it finished', async () => {
    const { executor } = fakeDb([[product('p-1'), product('p-2')], []]);
    const opts = options();

    const result = await backfillDraftPricing(
      executor as never,
      opts,
      frozenClock,
    );

    expect(result.done).toBe(true);
    expect(result.totals).toEqual({
      productsVisited: 2,
      offersResolved: 4,
      offersStillUnresolved: 0,
    });
    expect(opts.price).toHaveBeenCalledTimes(2);
  });

  it('reads only unpublished offers the rules have not priced', async () => {
    /*
      A published offer's price is what a buyer is being charged, and a draft
      that already carries one was priced by something — possibly a person.
      `product_offers` keeps no history, so overwriting either would be a
      permanent, invisible loss.
    */
    const { executor, wheres } = fakeDb([[]]);

    await backfillDraftPricing(executor as never, options(), frozenClock);

    expect(wheres[0]).toContain('"publish_state" = ');
    expect(wheres[0]).toContain('"pricing_state" = ');
  });

  it('reads strictly after a handed-back position', async () => {
    // Without this a backfill returns the same page forever and reports success
    // having covered a prefix — the shape the reprice dialog's "run it again"
    // advice had.
    const { executor, wheres } = fakeDb([[]]);

    await backfillDraftPricing(
      executor as never,
      options({ position: { afterProductId: 'p-9' } }),
      frozenClock,
    );

    expect(wheres[0]).toContain('"id" > ');
  });

  it('does not filter on a position when starting from the beginning', async () => {
    const { executor, wheres } = fakeDb([[]]);

    await backfillDraftPricing(executor as never, options(), frozenClock);

    expect(wheres[0]).not.toContain('"id" > ');
  });

  it('advances past a product the rules still refuse', async () => {
    /*
      The loop this prevents: a product that cannot be priced keeps its
      `UNRESOLVED` state, so it stays in the filter. If the position only moved
      on success it would be re-read on every call, forever, and the backfill
      would never reach anything behind it.
    */
    const { executor } = fakeDb([[product('p-1')], []]);
    const opts = options({
      price: vi.fn().mockResolvedValue({ resolved: 0, unresolved: 3 }),
    });

    const result = await backfillDraftPricing(
      executor as never,
      opts,
      frozenClock,
    );

    expect(result.done).toBe(true);
    expect(result.position.afterProductId).toBe('p-1');
    expect(result.totals.offersStillUnresolved).toBe(3);
  });

  it('stops on its budget and hands back the product it got to', async () => {
    let clock = 0;
    const ticking = () => {
      clock += 600;

      return clock;
    };
    const { executor } = fakeDb([
      [product('p-1'), product('p-2'), product('p-3')],
      [],
    ]);

    const result = await backfillDraftPricing(
      executor as never,
      options({ budgetMs: 1_000 }),
      ticking,
    );

    expect(result.done).toBe(false);
    expect(result.position.afterProductId).not.toBeNull();
  });

  it('an empty backlog is finished, not stuck', async () => {
    const { executor } = fakeDb([[]]);
    const opts = options();

    const result = await backfillDraftPricing(
      executor as never,
      opts,
      frozenClock,
    );

    expect(result.done).toBe(true);
    expect(result.totals.productsVisited).toBe(0);
    expect(opts.price).not.toHaveBeenCalled();
  });

  it('prices each product under the seller that stewards it', async () => {
    // The backlog spans sellers. Pricing one seller's product under another's
    // id would resolve it against the wrong account's market rules entirely.
    const { executor } = fakeDb([
      [
        { productId: 'p-1', sellerAccountId: 'seller-a' },
        { productId: 'p-2', sellerAccountId: 'seller-b' },
      ],
      [],
    ]);
    const opts = options();

    await backfillDraftPricing(executor as never, opts, frozenClock);

    expect(opts.price.mock.calls[0][1].sellerAccountId).toBe('seller-a');
    expect(opts.price.mock.calls[1][1].sellerAccountId).toBe('seller-b');
  });
});
