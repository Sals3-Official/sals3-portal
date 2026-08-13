// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { products } from '@/lib/db/schema/product-catalog';

const dialect = new PgDialect();

function renderSql(sql: SQL): { sql: string; params: unknown[] } {
  return dialect.sqlToQuery(sql);
}

type Recorded = { wheres: SQL[] };

function fakeDb(rows: unknown[], recorded: Recorded) {
  const builder: Record<string, unknown> = {};
  const chain = () => builder;

  ['select', 'from', 'leftJoin', 'orderBy', 'groupBy'].forEach((method) => {
    builder[method] = vi.fn(chain);
  });
  builder.where = vi.fn((condition: SQL) => {
    recorded.wheres.push(condition);

    return builder;
  });
  builder.limit = vi.fn(chain);
  builder.offset = vi.fn(() => Promise.resolve(rows));
  builder.then = (resolve: (value: unknown[]) => unknown) =>
    Promise.resolve(rows).then(resolve);

  return builder;
}

async function importWithDb(rows: unknown[]) {
  const recorded: Recorded = { wheres: [] };

  vi.resetModules();
  vi.doMock('@/lib/db/client', () => ({
    default: () => fakeDb(rows, recorded),
  }));

  const queries = await import('./catalogue-queries');

  return { queries, recorded };
}

describe('catalogue queries tenancy', () => {
  /**
   * The steward filter must live in the SAME `WHERE` as every other predicate -
   * rendered as SQL text, the same proof style as `repository.tenant-scope`.
   */
  it('scopes the listing read on the steward account in one statement', async () => {
    const { queries, recorded } = await importWithDb([]);

    await queries.listCatalogueRowsForSteward('seller-a', {
      states: ['UNPUBLISHED'],
      search: '',
      limit: 50,
      offset: 0,
    });

    const actual = renderSql(recorded.wheres[0]);
    const expected = renderSql(
      and(
        eq(products.stewardSellerAccountId, 'seller-a'),
        inArray(products.publicationState, ['UNPUBLISHED']),
      ) as SQL,
    );

    expect(actual.sql).toBe(expected.sql);
    expect(actual.params).toEqual(expected.params);
  });

  it('scopes the filtered count identically to the list', async () => {
    const { queries, recorded } = await importWithDb([{ total: 0 }]);

    await queries.countCatalogueRowsForSteward('seller-a', {
      states: ['UNPUBLISHED', 'PUBLISHED'],
      search: '',
    });
    await queries.listCatalogueRowsForSteward('seller-a', {
      states: ['UNPUBLISHED', 'PUBLISHED'],
      search: '',
      limit: 50,
      offset: 0,
    });

    expect(renderSql(recorded.wheres[0]).sql).toBe(
      renderSql(recorded.wheres[1]).sql,
    );
  });

  it('binds the search term as a parameter, never interpolated', async () => {
    const { queries, recorded } = await importWithDb([]);

    await queries.listCatalogueRowsForSteward('seller-a', {
      states: ['UNPUBLISHED'],
      search: "50%_off'; drop table products;--",
      limit: 50,
      offset: 0,
    });

    const rendered = renderSql(recorded.wheres[0]);

    expect(rendered.sql).not.toContain('drop table');
    // LIKE wildcards in the term are escaped literals, not wildcards.
    expect(rendered.params).toContainEqual(
      expect.stringContaining('50\\%\\_off'),
    );
  });

  it('scopes the per-state totals on the steward account', async () => {
    const { queries, recorded } = await importWithDb([
      { state: 'UNPUBLISHED', total: 3 },
    ]);

    const totals = await queries.countCatalogueByPublicationState('seller-a');

    expect(renderSql(recorded.wheres[0]).sql).toBe(
      renderSql(eq(products.stewardSellerAccountId, 'seller-a')).sql,
    );
    expect(totals).toEqual({
      UNPUBLISHED: 3,
      PUBLISHED: 0,
      PAUSED: 0,
      ARCHIVED: 0,
    });
  });
});
