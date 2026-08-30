// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { searchPublishedProducts } from './read-model';

/**
 * Search narrows the public catalogue, so it keeps every guarantee the
 * catalogue-wide query makes, and adds one of its own: the term a buyer typed
 * is matched as characters, not as a `LIKE` pattern.
 */

const dialect = new PgDialect();

function recordingExecutor(resultsPerSelect: unknown[][]) {
  const wheres: string[] = [];
  const havings: string[] = [];
  const params: unknown[][] = [];
  let selectIndex = -1;

  function chain(rows: unknown[]) {
    const builder: Record<string, unknown> = {};
    const self = (): unknown => builder;

    ['from', 'innerJoin', 'leftJoin', 'groupBy', 'orderBy'].forEach((name) => {
      builder[name] = vi.fn(self);
    });
    builder.where = vi.fn((condition: SQL | undefined) => {
      const rendered =
        condition === undefined ? undefined : dialect.sqlToQuery(condition);
      wheres.push(rendered?.sql ?? '');
      params.push(rendered?.params ?? []);

      return builder;
    });
    builder.having = vi.fn((condition: SQL | undefined) => {
      havings.push(
        condition === undefined ? '' : dialect.sqlToQuery(condition).sql,
      );

      return builder;
    });
    builder.as = vi.fn(() => ({ alias: 'matching_products' }));
    builder.limit = vi.fn(self);
    builder.offset = vi.fn(self);
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

  return { executor, wheres, havings, params };
}

const SELECTS = [[], [], [{ total: 0 }]];

function query(overrides: Record<string, unknown> = {}) {
  return {
    term: 'lamp',
    sort: 'newest' as const,
    page: 1,
    limit: 30,
    ...overrides,
  };
}

describe('searchPublishedProducts scope', () => {
  it.each([
    { label: 'product is published', fragment: '"publication_state" = ' },
    { label: 'product has a public slug', fragment: '"slug" is not null' },
    {
      label: 'offer is published',
      fragment: '"product_offers"."publish_state" = ',
    },
    {
      label: 'offer price is resolved',
      fragment: '"product_offers"."pricing_state" = ',
    },
    {
      label: 'offer carries an amount',
      fragment: '"price_amount_minor" is not null',
    },
    { label: 'title matches the term', fragment: 'ilike' },
  ])('requires that the $label', async ({ fragment }) => {
    const { executor, wheres } = recordingExecutor(SELECTS);

    await searchPublishedProducts(query(), executor as never);

    expect(wheres[0]?.toLowerCase()).toContain(fragment.toLowerCase());
  });

  /**
   * The SKU branch. Rendered SQL, not a trusted call: the whole value of this
   * harness is that it prints the predicate rather than believing it.
   */
  describe('a term that spells a Sals3 SKU', () => {
    const SKU = 'S3V-463ADA8A9E11';

    it('also looks for a variant carrying that exact SKU', async () => {
      const { executor, wheres, params } = recordingExecutor(SELECTS);

      await searchPublishedProducts(query({ term: SKU }), executor as never);

      const sql = wheres[0] ?? '';

      expect(sql.toLowerCase()).toContain('exists');
      expect(sql).toContain('"product_variants"."sals3_sku" =');
      expect(params[0]).toContain(SKU);
      // Still an OR with the title match, never a replacement for it.
      expect(sql.toLowerCase()).toContain('ilike');
    });

    it('accepts the code without its prefix, and in any case', async () => {
      const { executor, params } = recordingExecutor(SELECTS);

      await searchPublishedProducts(
        query({ term: '  463ada8a9e11  ' }),
        executor as never,
      );

      expect(params[0]).toContain(SKU);
    });

    /**
     * `S3V-4` is a hash prefix, not an intent. Matching it as a substring would
     * return whichever listings happen to collide on four characters.
     */
    it('does not treat a partial code as a SKU', async () => {
      const { executor, wheres } = recordingExecutor(SELECTS);

      await searchPublishedProducts(
        query({ term: 'S3V-463ADA' }),
        executor as never,
      );

      expect((wheres[0] ?? '').toLowerCase()).not.toContain('sals3_sku');
    });

    /** An ordinary search must not pay for a subquery it cannot match. */
    it('leaves an ordinary term as a title search alone', async () => {
      const { executor, wheres } = recordingExecutor(SELECTS);

      await searchPublishedProducts(query({ term: 'lamp' }), executor as never);

      expect((wheres[0] ?? '').toLowerCase()).not.toContain('sals3_sku');
      expect((wheres[0] ?? '').toLowerCase()).toContain('ilike');
    });

    /**
     * The reason this is `EXISTS` and not a join predicate: narrowing the joined
     * variants would change the card's own `From` price to the matched
     * variant's, so a buyer arriving by SKU would see a different figure from
     * everyone else looking at the same product.
     */
    it('does not narrow the joined variants the card aggregates over', async () => {
      const { executor, wheres } = recordingExecutor(SELECTS);

      await searchPublishedProducts(query({ term: SKU }), executor as never);

      const outer = (wheres[0] ?? '').replace(/EXISTS \([\s\S]*?\)/gi, '');

      expect(outer).not.toContain('sals3_sku');
    });
  });

  it('counts over exactly the predicate it lists over', async () => {
    const { executor, wheres } = recordingExecutor(SELECTS);

    await searchPublishedProducts(
      query({ sort: 'price-desc', page: 2, limit: 12 }),
      executor as never,
    );

    expect(wheres).toHaveLength(2);
    expect(wheres[1]).toBe(wheres[0]);
  });

  /**
   * The whole point of `escapeLikePattern`. A buyer typing `%` is searching for
   * a per-cent sign, not asking for the entire catalogue.
   */
  it('escapes LIKE wildcards in the term rather than honouring them', async () => {
    const { executor, params } = recordingExecutor(SELECTS);

    await searchPublishedProducts(
      query({ term: '50% off_now' }),
      executor as never,
    );

    const bound = params[0]?.find(
      (value): value is string =>
        typeof value === 'string' && value.includes('off'),
    );

    expect(bound).toBe('%50\\% off\\_now%');
  });

  it('does not narrow by department unless one is given', async () => {
    const bare = recordingExecutor(SELECTS);
    await searchPublishedProducts(query(), bare.executor as never);
    expect(bare.wheres[0]).not.toContain('"l1"');

    const scoped = recordingExecutor(SELECTS);
    await searchPublishedProducts(
      query({ departmentName: 'Home & Garden' }),
      scoped.executor as never,
    );
    expect(scoped.wheres[0]).toContain('"l1"');
  });

  it('bounds the aggregate price, not the raw offer rows', async () => {
    const { executor, havings, wheres } = recordingExecutor(SELECTS);

    await searchPublishedProducts(
      query({ minPriceMinor: 1500, maxPriceMinor: 3000 }),
      executor as never,
    );

    expect(havings[0]).toContain('min(');
    expect(havings[1]).toBe(havings[0]);
    expect(wheres[0]).not.toContain('>=');
  });
});
