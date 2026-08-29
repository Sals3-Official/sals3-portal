// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import { fakeDb } from '../../../test/fake-db';

vi.mock('server-only', () => ({}));

const { dbState } = vi.hoisted(() => ({ dbState: { db: null as unknown } }));

vi.mock('@/lib/db/client', () => ({
  default: () => dbState.db,
}));

const { readSellerSoldRows, readSellerSoldSummary, readSoldUnitsForProducts } =
  await import('./seller-sold-read');

const SELLER = '55555555-5555-4555-8555-555555555555';
const BEANIE = '11111111-1111-4111-8111-111111111111';
const MASK = '22222222-2222-4222-8222-222222222222';

/**
 * Aggregates arrive from the driver as strings — `sum()` of an integer column
 * is `numeric` and `bigint` is serialised. Every fixture below therefore uses
 * strings, because a test that hands back numbers would pass while the real
 * query returned `"142" + "96" = "14296"`.
 */
function saleRow(over: Record<string, unknown> = {}) {
  return {
    productId: BEANIE,
    currency: 'USD',
    currentTitle: 'Knitted Tam Beanie',
    frozenTitle: 'Knitted Tam Beanie (as ordered)',
    imageUrl: 'https://cdn.example/beanie.jpg',
    units: '142',
    orders: '118',
    revenueMinor: '133338',
    ...over,
  };
}

/**
 * Drizzle's condition objects hold back-references to their own table, so
 * `JSON.stringify` on one throws on the cycle. This walks for the bound values
 * instead, which is what the assertion actually cares about.
 */
function collectStrings(value: unknown): string[] {
  const seen = new Set<unknown>();
  const found: string[] = [];

  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      found.push(node);
      return;
    }

    if (node === null || typeof node !== 'object' || seen.has(node)) return;

    seen.add(node);
    Object.values(node as Record<string, unknown>).forEach(walk);
  };

  walk(value);

  return found;
}

describe('readSellerSoldRows', () => {
  it('merges review tallies by product without multiplying the units', async () => {
    const fake = fakeDb([
      [
        saleRow(),
        saleRow({
          productId: MASK,
          currentTitle: 'Face Mask',
          units: '96',
          orders: '88',
          revenueMinor: '32256',
        }),
      ],
      [
        { productId: BEANIE, reviewCount: '12', ratingSum: '55' },
        { productId: MASK, reviewCount: '1', ratingSum: '4' },
      ],
    ]);
    dbState.db = fake.db;

    const rows = await readSellerSoldRows(SELLER);

    // The whole reason the review tally is a second query: a join would have
    // produced 12 beanie rows and summed 142 twelve times.
    expect(rows[0].units).toBe(142);
    expect(rows[0].reviewCount).toBe(12);
    expect(rows[1].units).toBe(96);
    expect(rows[1].reviewCount).toBe(1);
  });

  it('averages the ratings to one decimal, and reports null when there are none', async () => {
    const fake = fakeDb([
      [
        saleRow(),
        saleRow({ productId: MASK, currentTitle: 'Face Mask', units: '96' }),
      ],
      [{ productId: BEANIE, reviewCount: '12', ratingSum: '55' }],
    ]);
    dbState.db = fake.db;

    const rows = await readSellerSoldRows(SELLER);

    // 55 / 12 = 4.583…
    expect(rows[0].averageRating).toBe(4.6);
    expect(rows[1].averageRating).toBeNull();
    expect(rows[1].reviewCount).toBe(0);
  });

  it('prefers the catalogue title and falls back to the frozen one', async () => {
    const fake = fakeDb([
      [
        saleRow({ currentTitle: 'Renamed In The Catalogue' }),
        saleRow({
          productId: MASK,
          currentTitle: null,
          frozenTitle: 'Deleted Product',
          units: '5',
        }),
      ],
      [],
    ]);
    dbState.db = fake.db;

    const rows = await readSellerSoldRows(SELLER);

    expect(rows[0].title).toBe('Renamed In The Catalogue');
    expect(rows[1].title).toBe('Deleted Product');
  });

  it('orders by units sold, breaking ties on title', async () => {
    const fake = fakeDb([
      [
        saleRow({ productId: MASK, currentTitle: 'Zebra', units: '5' }),
        saleRow({ currentTitle: 'Apple', units: '5' }),
        saleRow({ productId: MASK, currentTitle: 'Bestseller', units: '40' }),
      ],
      [],
    ]);
    dbState.db = fake.db;

    const rows = await readSellerSoldRows(SELLER);

    expect(rows.map((row) => row.title)).toEqual([
      'Bestseller',
      'Apple',
      'Zebra',
    ]);
  });

  it('scopes the sales read to the session seller account', async () => {
    const fake = fakeDb([[], []]);
    dbState.db = fake.db;

    await readSellerSoldRows(SELLER);

    const whereCalls = fake.calls.filter((call) => call.method === 'where');
    expect(whereCalls.length).toBeGreaterThan(0);
    expect(collectStrings(whereCalls)).toContain(SELLER);
  });
});

describe('readSellerSoldSummary', () => {
  it('takes distinct orders from the lines rather than adding the per-product counts', async () => {
    const fake = fakeDb([
      [{ units: '449', orders: '356', productCount: '7' }],
      [{ currency: 'USD', revenueMinor: '409530' }],
      [{ units: '6' }],
    ]);
    dbState.db = fake.db;

    const summary = await readSellerSoldSummary(SELLER);

    // 356, not the 401 that summing the seven per-product order counts gives:
    // one order carrying two of these products must count once.
    expect(summary.distinctOrders).toBe(356);
    expect(summary.totalUnits).toBe(449);
    expect(summary.productCount).toBe(7);
  });

  it('keeps refunded units out of the totals and reports them separately', async () => {
    const fake = fakeDb([
      [{ units: '449', orders: '356', productCount: '7' }],
      [{ currency: 'USD', revenueMinor: '409530' }],
      [{ units: '6' }],
    ]);
    dbState.db = fake.db;

    const summary = await readSellerSoldSummary(SELLER);

    expect(summary.refundedUnits).toBe(6);
    expect(summary.totalUnits).toBe(449);
  });

  it('returns revenue per currency, largest first', async () => {
    const fake = fakeDb([
      [{ units: '10', orders: '9', productCount: '2' }],
      [
        { currency: 'AUD', revenueMinor: '5000' },
        { currency: 'USD', revenueMinor: '9000' },
      ],
      [{ units: '0' }],
    ]);
    dbState.db = fake.db;

    const summary = await readSellerSoldSummary(SELLER);

    expect(summary.revenueByCurrency).toEqual([
      { currency: 'USD', revenueMinor: 9000 },
      { currency: 'AUD', revenueMinor: 5000 },
    ]);
  });

  it('reads zero rather than NaN when the account has sold nothing', async () => {
    const fake = fakeDb([[], [], []]);
    dbState.db = fake.db;

    const summary = await readSellerSoldSummary(SELLER);

    expect(summary).toEqual({
      totalUnits: 0,
      distinctOrders: 0,
      productCount: 0,
      revenueByCurrency: [],
      refundedUnits: 0,
    });
  });
});

describe('readSoldUnitsForProducts', () => {
  it('asks the database nothing when there are no products to ask about', async () => {
    const fake = fakeDb([[{ productId: BEANIE, units: '1' }]]);
    dbState.db = fake.db;

    const counts = await readSoldUnitsForProducts([]);

    expect(counts.size).toBe(0);
    expect(fake.calls).toEqual([]);
  });

  it('returns units keyed by product id', async () => {
    const fake = fakeDb([
      [
        { productId: BEANIE, units: '142' },
        { productId: MASK, units: '96' },
      ],
    ]);
    dbState.db = fake.db;

    const counts = await readSoldUnitsForProducts([BEANIE, MASK]);

    expect(counts.get(BEANIE)).toBe(142);
    expect(counts.get(MASK)).toBe(96);
  });

  it('omits a product nobody has bought rather than reporting zero', async () => {
    const fake = fakeDb([[{ productId: BEANIE, units: '3' }]]);
    dbState.db = fake.db;

    const counts = await readSoldUnitsForProducts([BEANIE, MASK]);

    // The caller decides what "no sales" renders as; the read model does not
    // invent a row for a product the query returned nothing for.
    expect(counts.has(MASK)).toBe(false);
  });
});

describe('the date window', () => {
  function boundsIn(calls: ReturnType<typeof fakeDb>['calls']): Date[] {
    const found: Date[] = [];
    const seen = new Set<unknown>();

    const walk = (node: unknown): void => {
      if (node instanceof Date) {
        found.push(node);
        return;
      }

      if (node === null || typeof node !== 'object' || seen.has(node)) return;

      seen.add(node);
      Object.values(node as Record<string, unknown>).forEach(walk);
    };

    walk(calls.filter((call) => call.method === 'where'));

    return found;
  }

  it('binds no date at all for the whole history', async () => {
    const fake = fakeDb([[], []]);
    dbState.db = fake.db;

    await readSellerSoldRows(SELLER);

    expect(boundsIn(fake.calls)).toEqual([]);
  });

  it('binds both bounds when a window is given', async () => {
    const fake = fakeDb([[], []]);
    dbState.db = fake.db;
    const from = new Date('2026-08-01T00:00:00.000Z');
    const to = new Date('2026-08-06T00:00:00.000Z');

    await readSellerSoldRows(SELLER, { from, to });

    const bounds = boundsIn(fake.calls).map((date) => date.toISOString());
    expect(bounds).toContain('2026-08-01T00:00:00.000Z');
    expect(bounds).toContain('2026-08-06T00:00:00.000Z');
  });

  it('applies the same window to the refunded figure as to the totals', async () => {
    const fake = fakeDb([[], [], []]);
    dbState.db = fake.db;
    const from = new Date('2026-08-01T00:00:00.000Z');

    await readSellerSoldSummary(SELLER, { from, to: null });

    // Four `where` clauses across the summary's three statements, and the
    // refunded one must carry the bound too — otherwise a 30-day view would
    // subtract a refund from outside its own window.
    const bounds = boundsIn(fake.calls).map((date) => date.toISOString());
    expect(
      bounds.filter((iso) => iso === '2026-08-01T00:00:00.000Z'),
    ).toHaveLength(3);
  });
});
