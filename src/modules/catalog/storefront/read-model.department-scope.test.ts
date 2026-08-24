// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import { listPublishedProductsInDepartment } from './read-model';

/**
 * The department browse narrows the public catalogue, so it has to keep every
 * guarantee the catalogue-wide query makes and add two of its own.
 *
 * Like `read-model.published-scope.test.ts`, this renders the SQL Drizzle would
 * actually send rather than asserting on behaviour, because the failures worth
 * catching here are invisible to a behavioural test against a mocked row:
 *
 * 1. Publication is still gated in the `WHERE`, not narrowed away by the
 *    department predicate replacing it.
 * 2. The count is taken over the same predicate **and the same `HAVING`** as
 *    the page. A count over a wider set invents empty pages; over a narrower
 *    one it hides real products.
 * 3. The price window filters the aggregate the buyer sees
 *    (`min(price_amount_minor)`), not the raw offer rows — see
 *    `listPublishedProductsInDepartment` for why a `WHERE` here would put a
 *    card outside the band it was returned for.
 */

const dialect = new PgDialect();

type Recorded = { rendered: string };

function render(condition: SQL | undefined): string {
  return condition === undefined ? '' : dialect.sqlToQuery(condition).sql;
}

function recordingExecutor(resultsPerSelect: unknown[][]) {
  const wheres: Recorded[] = [];
  const havings: Recorded[] = [];
  let selectIndex = -1;

  function chain(rows: unknown[]) {
    const builder: Record<string, unknown> = {};
    const self = (): unknown => builder;

    ['from', 'innerJoin', 'leftJoin', 'groupBy', 'orderBy'].forEach((name) => {
      builder[name] = vi.fn(self);
    });
    builder.where = vi.fn((condition: SQL | undefined) => {
      wheres.push({ rendered: render(condition) });

      return builder;
    });
    builder.having = vi.fn((condition: SQL | undefined) => {
      havings.push({ rendered: render(condition) });

      return builder;
    });
    // The count path ends `.as(alias)` and is then passed to `.from()`; it is
    // never awaited itself, so a plain marker object is enough.
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

  return { executor, wheres, havings };
}

/** Three `select()` calls: the page, the count's inner grouping, the count. */
const SELECTS = [[], [], [{ total: 0 }]];

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
  { label: 'row belongs to the department', fragment: `"l1" = ` },
];

function query(overrides: Record<string, unknown> = {}) {
  return {
    departmentName: 'Animals & Pet Supplies',
    sort: 'newest' as const,
    page: 1,
    limit: 30,
    ...overrides,
  };
}

describe('listPublishedProductsInDepartment scope', () => {
  it.each(REQUIRED_CONDITIONS)(
    'requires that the $label',
    async ({ fragment }) => {
      const { executor, wheres } = recordingExecutor(SELECTS);

      await listPublishedProductsInDepartment(query(), executor as never);

      expect(wheres[0]?.rendered).toContain(fragment);
    },
  );

  it('counts over exactly the predicate it lists over', async () => {
    const { executor, wheres } = recordingExecutor(SELECTS);

    await listPublishedProductsInDepartment(
      query({ sort: 'price-desc', page: 3, limit: 12 }),
      executor as never,
    );

    expect(wheres).toHaveLength(2);
    expect(wheres[1]?.rendered).toBe(wheres[0]?.rendered);
  });

  it('counts over exactly the price window it lists over', async () => {
    const { executor, havings } = recordingExecutor(SELECTS);

    await listPublishedProductsInDepartment(
      query({ minPriceMinor: 1500, maxPriceMinor: 3000 }),
      executor as never,
    );

    expect(havings).toHaveLength(2);
    expect(havings[1]?.rendered).toBe(havings[0]?.rendered);
  });

  /**
   * The bound has to sit on the aggregate. `min("product_offers"."price_amount_minor")`
   * in the `HAVING` is what makes the filter agree with the price on the card;
   * a bare column reference there would be the `WHERE`-shaped bug in disguise.
   */
  it('bounds the aggregate price, not the raw offer rows', async () => {
    const { executor, havings, wheres } = recordingExecutor(SELECTS);

    await listPublishedProductsInDepartment(
      query({ minPriceMinor: 1500, maxPriceMinor: 3000 }),
      executor as never,
    );

    expect(havings[0]?.rendered).toContain('min(');
    expect(havings[0]?.rendered).toContain('>=');
    expect(havings[0]?.rendered).toContain('<=');
    expect(wheres[0]?.rendered).not.toContain('>=');
  });

  /**
   * An unfiltered browse must render the same SQL it did before the price
   * filter existed, rather than an always-true comparison the planner then has
   * to see through.
   */
  it('emits no price bound when neither end is given', async () => {
    const { executor, havings } = recordingExecutor(SELECTS);

    await listPublishedProductsInDepartment(query(), executor as never);

    expect(havings.every((having) => having.rendered === '')).toBe(true);
  });

  it('accepts a one-sided price window', async () => {
    const { executor, havings } = recordingExecutor(SELECTS);

    await listPublishedProductsInDepartment(
      query({ minPriceMinor: 5000 }),
      executor as never,
    );

    expect(havings[0]?.rendered).toContain('>=');
    expect(havings[0]?.rendered).not.toContain('<=');
  });
});
