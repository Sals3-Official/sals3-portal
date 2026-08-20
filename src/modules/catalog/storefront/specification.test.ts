// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { DbExecutor } from '@/lib/db/client';
import { loadSpecification } from './specification';

/**
 * Two halves, both worth pinning.
 *
 * The **SQL** half asserts the three filters that decide what a buyer may read:
 * the join to the product's *current* category, the active controls version,
 * and the `ATTRIBUTE_CONTEXT_ONLY` exclusion. Each of those is a rule the
 * workbook owns, and dropping any one publishes something it did not authorise
 * — silently, because the row would look like every other row.
 *
 * The **transform** half asserts requirement ordering, the display mapping, and
 * that an empty value produces no row at all rather than a blank one.
 */

const dialect = new PgDialect();

type Row = {
  attributeName: string;
  values: string[];
  requirementLevel: 'REQUIRED' | 'RECOMMENDED' | 'OPTIONAL';
};

function fakeExecutor(rows: Row[]) {
  const joins: string[] = [];
  const wheres: string[] = [];

  const builder: Record<string, unknown> = {};
  const self = () => builder;

  builder.from = vi.fn(self);
  builder.innerJoin = vi.fn((_table: unknown, condition: SQL | undefined) => {
    if (condition !== undefined) {
      joins.push(dialect.sqlToQuery(condition).sql);
    }

    return builder;
  });
  builder.where = vi.fn((condition: SQL | undefined) => {
    if (condition !== undefined) {
      wheres.push(dialect.sqlToQuery(condition).sql);
    }

    return builder;
  });
  builder.orderBy = vi.fn(
    () => Promise.resolve(rows) as unknown as typeof builder,
  );

  const executor = {
    select: vi.fn(() => builder),
  } as unknown as DbExecutor;

  return { executor, joins, wheres };
}

describe('loadSpecification', () => {
  it('joins on the product current category, the active controls version, and excludes context-only attributes', async () => {
    const { executor, joins, wheres } = fakeExecutor([]);

    await loadSpecification(executor, 'product-1');

    const controlsJoin = joins.join(' ');

    expect(controlsJoin).toContain('"category_id"');
    expect(controlsJoin).toContain('"controls_version"');
    // The exclusion is a `<>`, so a newly added visibility value is published
    // by default rather than hidden by default. That is the correct direction
    // here: the workbook classifies every attribute, and a value it has not
    // classified yet does not exist.
    expect(controlsJoin).toContain('"seo_visibility" <>');
    expect(wheres.join(' ')).toContain('"product_id"');
  });

  it('orders required attributes before recommended before optional', async () => {
    const { executor } = fakeExecutor([
      {
        attributeName: 'Season',
        values: ['Autumn'],
        requirementLevel: 'OPTIONAL',
      },
      {
        attributeName: 'Material',
        values: ['Cotton'],
        requirementLevel: 'REQUIRED',
      },
      {
        attributeName: 'Pattern',
        values: ['Solid'],
        requirementLevel: 'RECOMMENDED',
      },
    ]);

    const specification = await loadSpecification(executor, 'product-1');

    expect(specification.map((entry) => entry.label)).toEqual([
      'Material',
      'Pattern',
      'Season',
    ]);
  });

  it('joins a multi-select attribute values into one answer', async () => {
    const { executor } = fakeExecutor([
      {
        attributeName: 'Season',
        values: ['Autumn', 'Winter'],
        requirementLevel: 'RECOMMENDED',
      },
    ]);

    await expect(loadSpecification(executor, 'product-1')).resolves.toEqual([
      { label: 'Season', value: 'Autumn, Winter' },
    ]);
  });

  it('shows Generic for the workbook UNBRANDED token and never the raw token', async () => {
    const { executor } = fakeExecutor([
      {
        attributeName: 'Brand',
        values: ['UNBRANDED'],
        requirementLevel: 'REQUIRED',
      },
    ]);

    const specification = await loadSpecification(executor, 'product-1');

    expect(specification).toEqual([{ label: 'Brand', value: 'Generic' }]);
    expect(JSON.stringify(specification)).not.toContain('UNBRANDED');
  });

  it('omits an attribute with no stored value rather than sending a blank row', async () => {
    const { executor } = fakeExecutor([
      { attributeName: 'Material', values: [], requirementLevel: 'REQUIRED' },
      {
        attributeName: 'Pattern',
        values: ['  '],
        requirementLevel: 'REQUIRED',
      },
      {
        attributeName: 'Season',
        values: ['Winter'],
        requirementLevel: 'REQUIRED',
      },
    ]);

    await expect(loadSpecification(executor, 'product-1')).resolves.toEqual([
      { label: 'Season', value: 'Winter' },
    ]);
  });

  it('keeps the workbook attribute name verbatim rather than re-casing it', async () => {
    const { executor } = fakeExecutor([
      {
        attributeName: 'Country of Origin',
        values: ['China'],
        requirementLevel: 'OPTIONAL',
      },
    ]);

    const specification = await loadSpecification(executor, 'product-1');

    expect(specification[0]?.label).toBe('Country of Origin');
  });
});
