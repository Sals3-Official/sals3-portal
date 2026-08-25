// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { Database } from '@/lib/db/client';
import {
  DDL_LOCK_TIMEOUT,
  OPEX_FLOOR_DDL_STATEMENTS,
  hasOpexFloorColumn,
  hasOpexFloorConstraints,
  migrateOpexFloor,
  runOpexFloorDdl,
} from './migrate-opex-floor';

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

describe('the statements this migration sends', () => {
  it('adds the column without asserting it is absent', () => {
    // A second run must not be an error. `IF NOT EXISTS` is what makes the
    // endpoint safe to call again after a timeout, when nobody can tell whether
    // the first call committed.
    expect(OPEX_FLOOR_DDL_STATEMENTS[0]).toContain('ADD COLUMN IF NOT EXISTS');
    expect(OPEX_FLOOR_DDL_STATEMENTS[0]).toContain('"min_contribution_rate"');
  });

  it('drops each constraint before adding it', () => {
    // `ADD CONSTRAINT` has no `IF NOT EXISTS` in Postgres. Without the paired
    // DROP, a re-run fails halfway and leaves the column added and the
    // constraints partly applied.
    const named = ['floor_exclusive', 'floor_rate_range'];

    named.forEach((name) => {
      const dropIndex = OPEX_FLOOR_DDL_STATEMENTS.findIndex(
        (statement) =>
          statement.includes('DROP CONSTRAINT IF EXISTS') &&
          statement.includes(name),
      );
      const addIndex = OPEX_FLOOR_DDL_STATEMENTS.findIndex(
        (statement) =>
          statement.includes('ADD CONSTRAINT') && statement.includes(name),
      );

      expect(dropIndex).toBeGreaterThanOrEqual(0);
      expect(addIndex).toBeGreaterThan(dropIndex);
    });
  });

  it('refuses a row carrying both floors', () => {
    const exclusive = OPEX_FLOOR_DDL_STATEMENTS.find(
      (statement) =>
        statement.includes('ADD CONSTRAINT') &&
        statement.includes('floor_exclusive'),
    );

    // The owner rule: one entry or the other, never both. `min_contribution_minor`
    // is NOT NULL DEFAULT 0, so "no amount floor" is `= 0`, not NULL — a check
    // written against NULL would admit exactly the rows it exists to refuse.
    expect(exclusive).toContain('"min_contribution_rate" IS NOT NULL');
    expect(exclusive).toContain('"min_contribution_minor" > 0');
    expect(exclusive).toContain('NOT (');
  });

  it('keeps the rate inside the open interval the resolver can divide by', () => {
    const range = OPEX_FLOOR_DDL_STATEMENTS.find(
      (statement) =>
        statement.includes('ADD CONSTRAINT') &&
        statement.includes('floor_rate_range'),
    );

    // `price = cost / (1 - rate)`: at 1 that divides by zero, and at 0 it
    // prices nothing. Both are typos, and a typo should be refused rather than
    // stored as a rule that can only ever fail.
    expect(range).toContain('> 0');
    expect(range).toContain('< 1');
    expect(range).toContain('IS NULL OR');
  });
});

describe('running the DDL', () => {
  it('bounds the lock before touching the table', async () => {
    const executed: string[] = [];

    await runOpexFloorDdl(fakeDb(executed, () => []));

    // The ALTER takes an ACCESS EXCLUSIVE lock; every pricing read queues
    // behind it. Failing fast is the only rollback story a DDL like this has.
    expect(executed[0]).toBe(`SET LOCAL lock_timeout = '${DDL_LOCK_TIMEOUT}'`);
    expect(executed[0]).toContain('SET LOCAL');
    expect(executed).toHaveLength(OPEX_FLOOR_DDL_STATEMENTS.length + 1);
  });

  it('reports the state on both sides of the run', async () => {
    const executed: string[] = [];
    let applied = false;

    const db = fakeDb(executed, (statement) => {
      if (statement.includes('information_schema.columns')) {
        return applied ? [{ '?column?': 1 }] : [];
      }
      if (statement.includes('pg_constraint')) {
        return applied
          ? [{ conname: 'a' }, { conname: 'b' }]
          : ([] as unknown[]);
      }
      if (statement.includes('ADD COLUMN')) applied = true;
      return [];
    });

    const result = await migrateOpexFloor(db);

    // "Before" and "after" separately, so a run that achieved nothing cannot
    // read as success — the failure the 2026-08-18 incident was made of.
    expect(result.columnExistedBefore).toBe(false);
    expect(result.constraintsExistedBefore).toBe(false);
    expect(result.columnExistsAfter).toBe(true);
    expect(result.constraintsExistAfter).toBe(true);
  });
});

describe('the read-only checks', () => {
  it('asks the database, not a migration ledger', async () => {
    const executed: string[] = [];
    const db = fakeDb(executed, () => []);

    await hasOpexFloorColumn(db);
    await hasOpexFloorConstraints(db);

    // A ledger records intent; these record reality. When the two disagree the
    // ledger is the one that is wrong, so it is never the thing consulted.
    expect(executed[0]).toContain('information_schema.columns');
    expect(executed[0]).toContain("'min_contribution_rate'");
    expect(executed[1]).toContain('pg_constraint');
  });

  it('counts both constraints, not just one', async () => {
    const db = fakeDb([], () => [
      { conname: 'pricing_store_defaults_floor_exclusive' },
    ]);

    // One of two present is a half-applied migration, which is the state that
    // silently admits a row with two floors. It must not read as true.
    expect(await hasOpexFloorConstraints(db)).toBe(false);
  });
});
