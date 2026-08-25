// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '@/lib/db/client';
import {
  DDL_LOCK_TIMEOUT,
  PER_MARKET_SCOPE_DDL_STATEMENTS,
  hasPerMarketScopeColumns,
  hasPerMarketScopeIndexes,
  migratePerMarketScope,
  runPerMarketScopeDdl,
} from './migrate-per-market-scope';

/**
 * A break-glass DDL only ever runs against production, by hand, once. Nothing
 * here can execute it, so what these cases can check is the shape of what will
 * be sent — which is exactly where this class of change has failed before.
 */

const dialect = new PgDialect();

/**
 * `String(sqlObject)` renders `"[object Object]"` and would let every assertion
 * below pass vacuously — the same trap `read-model.published-scope.test.ts`
 * records. The dialect is the only thing that shows what Postgres will receive.
 */
function fakeDb(executed: string[], rows: (sql: string) => unknown[]) {
  const execute = vi.fn(async (statement: SQL) => {
    const rendered = dialect.sqlToQuery(statement).sql;

    executed.push(rendered);

    return rows(rendered);
  });

  return {
    execute,
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ execute }),
    ),
  } as unknown as Database;
}

describe('the DDL statements', () => {
  it('adds market_code to both policy tables, not just the category one', () => {
    const sql = PER_MARKET_SCOPE_DDL_STATEMENTS.join('\n');

    // The floor lives on `pricing_store_defaults`, and the owner's reason for
    // per-destination pricing was operational expense — which is what the floor
    // carries. Scoping the margin alone moves half the rule.
    expect(sql).toContain(
      'ALTER TABLE "pricing_category_policies" ADD COLUMN IF NOT EXISTS "market_code"',
    );
    expect(sql).toContain(
      'ALTER TABLE "pricing_store_defaults" ADD COLUMN IF NOT EXISTS "market_code"',
    );
  });

  it('splits each ACTIVE unique index on market_code IS NULL', () => {
    const sql = PER_MARKET_SCOPE_DDL_STATEMENTS.join('\n');

    /**
     * The whole reason this migration is not one line.
     *
     * Postgres treats NULLs as distinct in a unique index, so adding
     * `market_code` to the original `(seller_account_id, category_id)` index
     * would have accepted two ACTIVE all-destinations policies for one category
     * and left the resolver with no deterministic row to choose. Each table
     * therefore gets a pair, split on the null-ness of the scope.
     */
    ['pricing_category_policies', 'pricing_store_defaults'].forEach((table) => {
      expect(sql).toContain(`"${table}_active_all_markets_key"`);
      expect(sql).toContain(`"${table}_active_market_key"`);
      expect(sql).toContain(`DROP INDEX IF EXISTS "${table}_active_key"`);
    });

    // Counted over the index statements only. The two CHECK constraints also
    // say `"market_code" IS NULL`, and folding them in would make this assert
    // four while proving nothing about the split.
    const indexStatements = PER_MARKET_SCOPE_DDL_STATEMENTS.filter((s) =>
      s.includes('CREATE UNIQUE INDEX'),
    ).join('\n');

    expect(indexStatements.match(/"market_code" IS NULL/g)).toHaveLength(2);
    expect(indexStatements.match(/"market_code" IS NOT NULL/g)).toHaveLength(2);
  });

  it('drops the old index before creating the replacements', () => {
    const order = PER_MARKET_SCOPE_DDL_STATEMENTS.map((s, i) => ({ s, i }));
    const dropped = order.find((e) =>
      e.s.includes(
        'DROP INDEX IF EXISTS "pricing_category_policies_active_key"',
      ),
    );
    const created = order.find((e) =>
      e.s.includes('"pricing_category_policies_active_all_markets_key"'),
    );

    // Both are in one transaction, so a failure between them rolls back to the
    // original index rather than leaving the table with none.
    expect(dropped?.i).toBeLessThan(created?.i ?? -1);
  });

  it('makes every statement re-runnable without an exception handler', () => {
    /**
     * `ADD CONSTRAINT` has no `IF NOT EXISTS` form, and the recorded lesson is
     * that a `catch` inside one shared transaction is useless — the first
     * already-existing object poisons the connection and every later statement
     * fails. Each `ADD CONSTRAINT` is therefore preceded by its own
     * `DROP CONSTRAINT IF EXISTS`.
     */
    PER_MARKET_SCOPE_DDL_STATEMENTS.forEach((statement, index) => {
      if (!statement.includes('ADD CONSTRAINT')) return;

      const name = /ADD CONSTRAINT "([^"]+)"/.exec(statement)?.[1];
      const previous = PER_MARKET_SCOPE_DDL_STATEMENTS[index - 1] ?? '';

      expect(name).toBeDefined();
      expect(previous).toContain(`DROP CONSTRAINT IF EXISTS "${name}"`);
    });
  });

  it('admits the unscoped rule through the shape check', () => {
    const checks = PER_MARKET_SCOPE_DDL_STATEMENTS.filter((s) =>
      s.includes('CHECK'),
    );

    expect(checks).toHaveLength(2);
    // A CHECK passes on NULL anyway; saying so explicitly is what stops the next
    // reader "tightening" it to `market_code ~ '^[A-Z]{2}$'` and making every
    // existing all-destinations policy unwritable.
    checks.forEach((statement) => {
      expect(statement).toContain('"market_code" IS NULL OR');
      expect(statement).toContain("~ '^[A-Z]{2}$'");
    });
  });
});

describe('runPerMarketScopeDdl', () => {
  it('sets a lock timeout before touching either table', async () => {
    const executed: string[] = [];

    await runPerMarketScopeDdl(fakeDb(executed, () => []));

    // The real hazard is the ACCESS EXCLUSIVE lock, not the columns: without
    // this, a long-running query makes every pricing read queue behind the ALTER.
    expect(executed[0]).toContain(
      `SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`,
    );
    expect(executed).toHaveLength(PER_MARKET_SCOPE_DDL_STATEMENTS.length + 1);
  });

  it('runs everything in one transaction', async () => {
    const executed: string[] = [];
    const db = fakeDb(executed, () => []);

    await runPerMarketScopeDdl(db);

    expect(vi.mocked(db.transaction)).toHaveBeenCalledTimes(1);
  });
});

describe('the readings', () => {
  it('reports columns present only when BOTH tables have one', async () => {
    const bothRows = [{ table_name: 'a' }, { table_name: 'b' }];

    await expect(
      hasPerMarketScopeColumns(fakeDb([], () => bothRows)),
    ).resolves.toBe(true);
    // One table migrated and the other not is a half-applied schema, and
    // reporting it as success is how a reader ships against a table that cannot
    // take it.
    await expect(
      hasPerMarketScopeColumns(fakeDb([], () => [{ table_name: 'a' }])),
    ).resolves.toBe(false);
  });

  it('reports indexes present only when all four exist', async () => {
    const four = [1, 2, 3, 4].map((n) => ({ indexname: `i${n}` }));

    await expect(
      hasPerMarketScopeIndexes(fakeDb([], () => four)),
    ).resolves.toBe(true);
    await expect(
      hasPerMarketScopeIndexes(fakeDb([], () => four.slice(0, 3))),
    ).resolves.toBe(false);
  });

  it('reports columns and indexes separately in the run result', async () => {
    /**
     * Answers each reading with the row count that reading calls success — two
     * for the columns, four for the indexes — so the assertion below is about
     * the result shape rather than about one number happening to satisfy both.
     */
    const migrated = (sql: string): unknown[] =>
      sql.includes('pg_indexes')
        ? [1, 2, 3, 4].map((n) => ({ indexname: `i${n}` }))
        : [{ table_name: 'a' }, { table_name: 'b' }];
    const result = await migratePerMarketScope(fakeDb([], migrated));

    /**
     * They fail differently and the workflow asserts both. A missing column
     * breaks every write immediately and loudly; a missing index breaks nothing
     * until two rows collide, and by then the resolver has already picked
     * between them arbitrarily. One flag would have called that success.
     */
    expect(result).toMatchObject({
      ok: true,
      columnsExistAfter: true,
      indexesExistAfter: true,
    });
    expect(result.ddl.statementsRun).toBe(
      PER_MARKET_SCOPE_DDL_STATEMENTS.length,
    );
  });
});
