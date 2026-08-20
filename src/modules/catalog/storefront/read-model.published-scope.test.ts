// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  findPublishedProductBySlug,
  listPublishedProducts,
} from './read-model';

/**
 * Publication is a `WHERE` clause or it is not a gate.
 *
 * These tests render the real SQL Drizzle would send — comparing
 * `String(sqlObject)` would render `"[object Object]"` and pass vacuously —
 * and assert two things that a passing behavioural test could not:
 *
 * 1. Every condition that makes a row public is present. An unpublished
 *    product, an unpriced offer, or unreviewed media leaking
 *    into a public feed is not a cosmetic bug.
 * 2. The count query's predicate is **identical** to the list query's.
 *    A count over a wider predicate invents pages that render empty; a count
 *    over a narrower one hides real products behind a too-low page total.
 */

const dialect = new PgDialect();

type Recorded = { where: SQL | undefined; rendered: string };

function recordingExecutor(resultsPerSelect: unknown[][]) {
  const recorded: Recorded[] = [];
  let selectIndex = -1;

  function chain(rows: unknown[]) {
    const builder: Record<string, unknown> = {};
    const self = (): unknown => builder;

    ['from', 'innerJoin', 'leftJoin', 'groupBy', 'orderBy'].forEach((name) => {
      builder[name] = vi.fn(self);
    });
    builder.where = vi.fn((condition: SQL | undefined) => {
      recorded.push({
        where: condition,
        rendered:
          condition === undefined ? '' : dialect.sqlToQuery(condition).sql,
      });

      return builder;
    });
    builder.limit = vi.fn(self);
    builder.offset = vi.fn(self);
    // Both query shapes are awaited: the list path ends at `.offset(...)`,
    // the count path at `.where(...)`. A thenable covers both without
    // guessing which method terminates the chain.
    builder.then = (resolve: (value: unknown) => unknown) => resolve(rows);

    return builder;
  }

  const executor = {
    select: vi.fn(() => {
      selectIndex += 1;

      return chain(resultsPerSelect[selectIndex] ?? []);
    }),
    selectDistinct: vi.fn(() => chain([])),
  };

  return { executor, recorded };
}

const REQUIRED_CONDITIONS = [
  { label: 'product is published', fragment: `"publication_state" = ` },
  { label: 'product has a public slug', fragment: `"slug" is not null` },
  {
    label: 'offer is published',
    fragment: `"product_offers"."publish_state" = `,
  },
  {
    label: 'offer price is resolved',
    fragment: `"product_offers"."pricing_state" = `,
  },
  {
    label: 'offer carries an amount',
    fragment: `"price_amount_minor" is not null`,
  },
];

describe('listPublishedProducts scope', () => {
  it.each(REQUIRED_CONDITIONS)(
    'requires that the $label',
    async ({ fragment }) => {
      const { executor, recorded } = recordingExecutor([[], [{ total: 0 }]]);

      await listPublishedProducts(
        { section: 'for-you', page: 1, limit: 14 },
        executor as never,
      );

      expect(recorded[0]?.rendered).toContain(fragment);
    },
  );

  it('counts over exactly the predicate it lists over', async () => {
    const { executor, recorded } = recordingExecutor([[], [{ total: 0 }]]);

    await listPublishedProducts(
      { section: 'deals', page: 3, limit: 30 },
      executor as never,
    );

    expect(recorded).toHaveLength(2);
    expect(recorded[1]?.rendered).toBe(recorded[0]?.rendered);
  });

  /**
   * The public catalogue is cross-seller by design. A tenant filter here would
   * hide one seller's genuinely live product with no rule saying it should be
   * hidden, and it would silently change what "published" means.
   */
  it('applies no tenant filter and no screening join', async () => {
    const { executor, recorded } = recordingExecutor([[], [{ total: 0 }]]);

    await listPublishedProducts(
      { section: 'for-you', page: 1, limit: 14 },
      executor as never,
    );

    const rendered = recorded[0]?.rendered ?? '';

    expect(rendered).not.toContain('seller_account_id');
    expect(rendered).not.toContain('supplier_connection');
    expect(rendered).not.toContain('candidate');
  });

  it('pages with real offsets on the requested limit', async () => {
    const { executor } = recordingExecutor([[], [{ total: 0 }]]);

    await listPublishedProducts(
      { section: 'for-you', page: 3, limit: 14 },
      executor as never,
    );

    const chain = executor.select.mock.results[0]?.value as {
      limit: ReturnType<typeof vi.fn>;
      offset: ReturnType<typeof vi.fn>;
    };

    expect(chain.limit).toHaveBeenCalledWith(14);
    expect(chain.offset).toHaveBeenCalledWith(28);
  });

  /**
   * The joins fan one product out into one row per published offer, so a plain
   * `count()` would report offer rows as products.
   */
  it('counts distinct products, not offer rows', async () => {
    const { executor } = recordingExecutor([[], [{ total: 0 }]]);

    await listPublishedProducts(
      { section: 'for-you', page: 1, limit: 14 },
      executor as never,
    );

    const countSelection = executor.select.mock.calls[1] as unknown as
      [{ total: SQL }] | undefined;
    const total = countSelection?.[0].total;

    expect(total).toBeDefined();
    expect(dialect.sqlToQuery(total as SQL).sql).toContain('distinct');
  });

  it('drops a row whose price or slug contradicts the scope', async () => {
    const { executor } = recordingExecutor([
      [
        {
          id: 'a',
          slug: null,
          title: 'Half-published',
          publishedAt: new Date('2026-08-13T00:00:00.000Z'),
          priceMinor: '4299',
          priceCurrency: 'USD',
          availabilityState: 'UNKNOWN',
          categoryCode: null,
          categoryPath: null,
          primaryImageUrl: null,
        },
      ],
      [{ total: 1 }],
    ]);

    const page = await listPublishedProducts(
      { section: 'for-you', page: 1, limit: 14 },
      executor as never,
    );

    expect(page.rows).toEqual([]);
  });

  it('converts the bigint price aggregate and the timestamp at the boundary', async () => {
    const { executor } = recordingExecutor([
      [
        {
          id: 'a',
          slug: 'a-real-product',
          title: 'A Real Product',
          publishedAt: new Date('2026-08-13T01:02:03.000Z'),
          // `min()` over a bigint column comes back as text from postgres.js.
          priceMinor: '4299',
          priceCurrency: 'USD',
          availabilityState: 'AVAILABLE',
          categoryCode: 'CAT-APP-100412',
          categoryPath: "Apparel > Outerwear > Men's Jackets",
          primaryImageUrl: 'https://cf.cjdropshipping.com/quick/product/a.jpg',
        },
      ],
      [{ total: 1 }],
    ]);

    const page = await listPublishedProducts(
      { section: 'for-you', page: 1, limit: 14 },
      executor as never,
    );

    // JSON-safe only: `unstable_cache` persists this value with
    // `JSON.stringify`, which throws on a bigint and silently turns a Date
    // into a string that no longer type-checks as one.
    expect(page.rows[0]?.priceMinor).toBe(4299);
    expect(page.rows[0]?.publishedAt).toBe('2026-08-13T01:02:03.000Z');
    expect(JSON.parse(JSON.stringify(page.rows[0]))).toEqual(page.rows[0]);
  });
});

describe('findPublishedProductBySlug scope', () => {
  it('adds the slug to the same published predicate', async () => {
    const { executor, recorded } = recordingExecutor([[]]);

    await findPublishedProductBySlug('a-real-product', executor as never);

    const rendered = recorded[0]?.rendered ?? '';

    expect(rendered).toContain(`"publication_state" = `);
    expect(rendered).toContain(`"slug" = `);
  });
});

/**
 * The editor's "Show supplier photo" switch is a `WHERE` clause too, or it is
 * not a gate: `products.show_supplier_photo` off must hide the supplier's
 * original from buyers — but only once an approved seller upload exists, so a
 * product whose seller has uploaded nothing yet still renders the supplier
 * photo instead of an empty gallery. Seller uploads always outrank supplier
 * originals, matching the editor preview's `[...media, ...supplierMedia]`.
 */
describe('buyer-visible media selection', () => {
  async function renderedPrimaryImageSql(): Promise<string> {
    const { executor } = recordingExecutor([[], [{ total: 0 }]]);

    await listPublishedProducts(
      { section: 'for-you', page: 1, limit: 14 },
      executor as never,
    );

    const selection = executor.select.mock.calls[0] as unknown as
      [{ primaryImageUrl: SQL }] | undefined;

    expect(selection?.[0].primaryImageUrl).toBeDefined();

    return dialect.sqlToQuery(selection?.[0].primaryImageUrl as SQL).sql;
  }

  it('gates the card image on the seller’s supplier-photo switch', async () => {
    const rendered = await renderedPrimaryImageSql();

    expect(rendered).toContain('"show_supplier_photo"');
    expect(rendered).toContain(`= 'SELLER_UPLOAD'`);
    // The fallback: with no approved seller upload, the switch hides nothing.
    expect(rendered).toContain('not exists');
  });

  it('orders seller uploads ahead of supplier originals on the card', async () => {
    const rendered = await renderedPrimaryImageSql();

    expect(rendered).toMatch(/= 'SELLER_UPLOAD'\) desc/);
  });

  it('applies the same gate and precedence to the detail gallery', async () => {
    const { executor, recorded } = recordingExecutor([
      [
        {
          id: 'a',
          slug: 'a-real-product',
          title: 'A Real Product',
          publishedAt: new Date('2026-08-13T01:02:03.000Z'),
          priceMinor: '4299',
          priceCurrency: 'USD',
          availabilityState: 'AVAILABLE',
          categoryCode: 'CAT-APP-100412',
          categoryPath: "Apparel > Outerwear > Men's Jackets",
          primaryImageUrl: 'https://cf.cjdropshipping.com/quick/product/a.jpg',
        },
      ],
      // loadApprovedImages, loadDescriptionBlocks, loadPublishedVariants,
      // loadSpecs — in the Promise.all order `findPublishedProductBySlug` uses.
      [],
      [],
      [],
      [],
    ]);

    await findPublishedProductBySlug('a-real-product', executor as never);

    // recorded[0] is the base row's scope; recorded[1] is the gallery's WHERE.
    const gallery = recorded[1]?.rendered ?? '';

    expect(gallery).toContain('"show_supplier_photo"');
    expect(gallery).toContain(`= 'SELLER_UPLOAD'`);
    expect(gallery).toContain('not exists');
  });
});
