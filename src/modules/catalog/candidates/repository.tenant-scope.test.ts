import { describe, expect, it, vi } from 'vitest';
import { and, eq, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { supplierCandidates } from '@/lib/db/schema/catalog';
import { supplierConnections } from '@/lib/db/schema/supplier-connections';
import { candidateBelongsToSeller } from './repository';

/**
 * Renders real SQL text via `PgDialect` - the same pure, connection-free
 * renderer Drizzle itself uses before sending a query to `postgres.js`.
 * Drizzle's `SQL` class has no custom `toString()`, so comparing
 * `String(sqlObject)` directly always renders `"[object Object]"`
 * regardless of content - that would make a comparison vacuous (always
 * pass, prove nothing). `and()`'s TS signature allows `undefined` only
 * because it also accepts zero conditions; every call here passes two, so
 * it is never actually undefined at runtime - asserted explicitly rather
 * than silenced.
 */
const dialect = new PgDialect();

function renderSql(sql: SQL | undefined): { sql: string; params: unknown[] } {
  if (sql === undefined) {
    throw new Error('Expected a defined SQL condition, got undefined.');
  }

  return dialect.sqlToQuery(sql);
}

/**
 * Verifies `candidateBelongsToSeller` builds one query with both the
 * candidate-id and seller-account-id conditions ANDed together - never a
 * separate "does the candidate exist" check followed by an ownership check
 * in application code, which would leave a window for the wrong assumption.
 * Drizzle's query builder is exercised for real here (the `and`/`eq`
 * conditions are real SQL AST nodes); only the final `.limit()` promise is
 * a fake, since asserting against a live database is the e2e suite's job.
 */
function fakeExecutor(resolvedRows: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(resolvedRows),
  };

  return builder as never;
}

describe('candidateBelongsToSeller', () => {
  it('queries with both conditions ANDed in one WHERE clause', async () => {
    const executor = fakeExecutor([{ id: 'candidate-a' }]);

    await candidateBelongsToSeller(executor, 'candidate-a', 'seller-a');

    const whereArg = (executor as { where: ReturnType<typeof vi.fn> }).where
      .mock.calls[0][0];
    const expected = and(
      eq(supplierCandidates.id, 'candidate-a'),
      eq(supplierConnections.sellerAccountId, 'seller-a'),
    );

    // `and(eq(...), eq(...))` builds a real SQL AST node - rendering its
    // actual SQL text is a meaningful check that both conditions are
    // actually present and ANDed, not a superficial "was called" assertion.
    const actualQuery = renderSql(whereArg as SQL);
    const expectedQuery = renderSql(expected);

    expect(actualQuery.sql).toBe(expectedQuery.sql);
    expect(actualQuery.params).toEqual(expectedQuery.params);
  });

  it('returns true when the joined query finds a matching row', async () => {
    const executor = fakeExecutor([{ id: 'candidate-a' }]);

    await expect(
      candidateBelongsToSeller(executor, 'candidate-a', 'seller-a'),
    ).resolves.toBe(true);
  });

  it('returns false when no row matches (wrong seller or unknown candidate)', async () => {
    const executor = fakeExecutor([]);

    await expect(
      candidateBelongsToSeller(executor, 'candidate-a', 'seller-b'),
    ).resolves.toBe(false);
  });
});
