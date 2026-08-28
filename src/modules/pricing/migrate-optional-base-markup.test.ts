// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '@/lib/db/client';
import {
  DDL_LOCK_TIMEOUT,
  OPTIONAL_BASE_MARKUP_DDL_STATEMENTS,
  baseMarkupIsRequired,
  migrateOptionalBaseMarkup,
  runOptionalBaseMarkupDdl,
} from './migrate-optional-base-markup';

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

describe('the statement this migration sends', () => {
  it('widens the column rather than giving it a default', () => {
    // A `DEFAULT 0` would satisfy the same insert and quietly price at cost.
    // Absence has to stay distinguishable from zero, because the resolver
    // treats them differently: no rule at all versus a rule that earns nothing.
    const [statement] = OPTIONAL_BASE_MARKUP_DDL_STATEMENTS;

    expect(statement).toContain('"target_margin_rate" DROP NOT NULL');
    // Anchored to `SET DEFAULT` rather than the bare word: the table is named
    // `pricing_store_defaults`, so a case-insensitive search for "default"
    // matches every statement here and would pass whatever this did.
    expect(statement).not.toMatch(/SET DEFAULT/i);
  });

  it('touches only the base markup, never the floor beside it', () => {
    // The floor columns live on this same row and are the reason the row now
    // exists at all. A migration that widened one of those by accident would
    // remove the only guard on the number the owner actually wants enforced.
    const joined = OPTIONAL_BASE_MARKUP_DDL_STATEMENTS.join('\n');

    expect(joined).not.toContain('min_contribution');
  });

  it('adds no constraint, so a legacy row cannot abort the change', () => {
    // `ADD CONSTRAINT` validates existing rows. One row holding a 0 would roll
    // the transaction back and take the DROP NOT NULL with it — losing the half
    // that matters over the half that does not.
    const joined = OPTIONAL_BASE_MARKUP_DDL_STATEMENTS.join('\n');

    expect(joined).not.toMatch(/ADD CONSTRAINT/i);
  });

  it('bounds the lock it takes before touching the table', async () => {
    // `ALTER TABLE` takes an ACCESS EXCLUSIVE lock. Without a timeout it queues
    // behind any long read and every pricing query queues behind it.
    const executed: string[] = [];

    await runOptionalBaseMarkupDdl(fakeDb(executed, () => []));

    expect(executed[0]).toBe(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`);
    expect(executed[0]).toContain('SET LOCAL');
  });

  it('sends the DDL inside the transaction that set the timeout', async () => {
    // A `SET LOCAL` outside the transaction is silently scoped to nothing, so
    // the guard above would read as present while protecting nothing.
    const executed: string[] = [];
    const db = fakeDb(executed, () => []);

    await runOptionalBaseMarkupDdl(db);

    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(executed).toHaveLength(
      OPTIONAL_BASE_MARKUP_DDL_STATEMENTS.length + 1,
    );
  });
});

describe('the state it reports', () => {
  function requiredWhen(stillRequired: boolean) {
    return (statement: string) =>
      statement.includes('information_schema.columns') && stillRequired
        ? [{ '?column?': 1 }]
        : [];
  }

  it('asks the database, not a migration ledger', async () => {
    // The ledger records intent; this records reality. The 2026-08-18 outage is
    // what happens when the two disagree and only the ledger is consulted.
    const executed: string[] = [];

    await baseMarkupIsRequired(fakeDb(executed, requiredWhen(true)));

    expect(executed[0]).toContain('information_schema.columns');
    expect(executed[0]).toContain("is_nullable = 'NO'");
    expect(executed[0]).toContain("column_name = 'target_margin_rate'");
  });

  it('reads a still-required column as required', async () => {
    expect(await baseMarkupIsRequired(fakeDb([], requiredWhen(true)))).toBe(
      true,
    );
  });

  it('reads an already-nullable column as not required', async () => {
    expect(await baseMarkupIsRequired(fakeDb([], requiredWhen(false)))).toBe(
      false,
    );
  });

  it('reports before and after, so a run that changed nothing cannot read as success', async () => {
    // The endpoint returns 200 either way. `wasRequiredBefore: false` paired
    // with `isRequiredAfter: false` is the difference between "already done"
    // and "did it" — and a caller checking only `ok` would see no difference at
    // all.
    let required = true;
    const db = fakeDb([], (statement) => {
      if (!statement.includes('information_schema.columns')) return [];

      const rows = required ? [{ '?column?': 1 }] : [];

      return rows;
    });

    const original = db.transaction as unknown as ReturnType<typeof vi.fn>;

    original.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => {
        const result = await fn({ execute: db.execute });

        required = false;

        return result;
      },
    );

    expect(await migrateOptionalBaseMarkup(db)).toEqual({
      ok: true,
      wasRequiredBefore: true,
      statementsRun: OPTIONAL_BASE_MARKUP_DDL_STATEMENTS.length,
      isRequiredAfter: false,
    });
  });
});
