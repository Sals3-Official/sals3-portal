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
