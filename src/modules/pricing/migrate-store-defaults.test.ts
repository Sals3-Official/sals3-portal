// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  DDL_LOCK_TIMEOUT,
  hasStoreDefaultsTable,
  markMigration0024Applied,
  migrateStoreDefaults,
  runStoreDefaultsDdl,
  STORE_DEFAULTS_DDL_STATEMENTS,
} from './migrate-store-defaults';

const MIGRATION_0024_CREATED_AT = 1787143758012;

/** Recovers the literal SQL text passed to `sql.raw(...)`. */
function rawStatementText(query: unknown): string {
  const chunks =
    (query as { queryChunks?: { value?: unknown[] }[] } | null)?.queryChunks ??
    [];

  return chunks
    .map((chunk) =>
      typeof chunk.value?.[0] === 'string' ? chunk.value[0] : '',
    )
    .join('');
}

/** A db whose `transaction` hands the callback a recording executor. */
function fakeTransactionalDb(execute = vi.fn().mockResolvedValue(undefined)) {
  const db = {
    execute,
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({ execute }),
    ),
  };

  return { db, execute };
}

describe('runStoreDefaultsDdl', () => {
  it('runs every DDL statement inside one transaction, in declaration order', async () => {
    const { db, execute } = fakeTransactionalDb();

    const result = await runStoreDefaultsDdl(db as never);

    expect(result.statementsRun).toBe(STORE_DEFAULTS_DDL_STATEMENTS.length);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    // Call 0 is the lock_timeout; 1..n are the statements in order.
    STORE_DEFAULTS_DDL_STATEMENTS.forEach((statement, index) => {
      expect(rawStatementText(execute.mock.calls[index + 1]?.[0])).toBe(
        statement,
      );
    });
  });

  it('bounds the ACCESS EXCLUSIVE lock wait before touching anything', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runStoreDefaultsDdl(db as never);

    const first = rawStatementText(execute.mock.calls[0]?.[0]);
    expect(first).toContain('lock_timeout');
    expect(first).toContain(DDL_LOCK_TIMEOUT);
  });

  it('scopes the timeout to the transaction, never the session', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runStoreDefaultsDdl(db as never);

    expect(rawStatementText(execute.mock.calls[0]?.[0])).toContain('SET LOCAL');
  });

  it('uses IF NOT EXISTS / guarded DO blocks so a second call needs no error tolerance', () => {
    const [table, fk, uniqueIndex, sellerIndex] = STORE_DEFAULTS_DDL_STATEMENTS;

    expect(table).toContain('CREATE TABLE IF NOT EXISTS');
    // Postgres has no ADD CONSTRAINT IF NOT EXISTS — the guard is a DO block.
    expect(fk).toContain('IF NOT EXISTS');
    expect(fk).toContain('pg_constraint');
    expect(uniqueIndex).toContain('CREATE UNIQUE INDEX IF NOT EXISTS');
    expect(sellerIndex).toContain('CREATE INDEX IF NOT EXISTS');
  });

  it('enforces one ACTIVE store default per seller with a partial unique index', () => {
    const uniqueIndex = STORE_DEFAULTS_DDL_STATEMENTS[2];

    expect(uniqueIndex).toContain('"pricing_store_defaults_active_key"');
    expect(uniqueIndex).toContain(
      `WHERE "pricing_store_defaults"."status" = 'ACTIVE'`,
    );
  });

  it('does not recreate the shared pricing enums — a database without 0012 must fail loudly', () => {
    const joined = STORE_DEFAULTS_DDL_STATEMENTS.join('\n');

    expect(joined).not.toContain('CREATE TYPE');
  });

  it('does not swallow a real database error', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(undefined) // lock_timeout
      .mockRejectedValueOnce(new Error('permission denied'));
    const { db } = fakeTransactionalDb(execute);

    await expect(runStoreDefaultsDdl(db as never)).rejects.toThrow(
      'permission denied',
    );
  });

  it('propagates a lock timeout instead of reporting success', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(
        new Error('canceling statement due to lock timeout'),
      );
    const { db } = fakeTransactionalDb(execute);

    await expect(runStoreDefaultsDdl(db as never)).rejects.toThrow(
      'lock timeout',
    );
  });
});

describe('hasStoreDefaultsTable', () => {
  it('answers from information_schema, true when a row comes back', async () => {
    const execute = vi.fn().mockResolvedValue([{ '?column?': 1 }]);

    await expect(hasStoreDefaultsTable({ execute } as never)).resolves.toBe(
      true,
    );
    expect(rawStatementText(execute.mock.calls[0]?.[0])).toContain(
      'information_schema.tables',
    );
  });

  it('answers false when no row comes back', async () => {
    const execute = vi.fn().mockResolvedValue([]);

    await expect(hasStoreDefaultsTable({ execute } as never)).resolves.toBe(
      false,
    );
  });
});

describe('markMigration0024Applied', () => {
  it('inserts the ledger row when none exists yet', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(undefined) // CREATE SCHEMA
      .mockResolvedValueOnce(undefined) // CREATE TABLE
      .mockResolvedValueOnce([]) // SELECT — not applied yet
      .mockResolvedValueOnce(undefined); // INSERT

    const result = await markMigration0024Applied({ execute } as never);

    expect(result).toEqual({
      createdAt: MIGRATION_0024_CREATED_AT,
      inserted: true,
    });
    expect(rawStatementText(execute.mock.calls[3]?.[0])).toContain('INSERT');
  });

  it('is a no-op when the ledger already records 0024', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: 24 }]);

    const result = await markMigration0024Applied({ execute } as never);

    expect(result).toEqual({
      createdAt: MIGRATION_0024_CREATED_AT,
      inserted: false,
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });
});

describe('migrateStoreDefaults', () => {
  it('observes before, applies, records, and re-observes after', async () => {
    const results: unknown[][] = [
      [], // hasStoreDefaultsTable before → false
      // transaction statements share `execute` below
    ];
    const execute = vi.fn().mockImplementation(() => {
      const next = results.shift();
      return Promise.resolve(next ?? []);
    });
    // Sequence: before-check([]), lock, 4 DDL, schema, table, select([]),
    // insert, after-check([row]).
    execute
      .mockResolvedValueOnce([]) // before
      .mockResolvedValueOnce(undefined) // lock_timeout
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined) // CREATE SCHEMA
      .mockResolvedValueOnce(undefined) // CREATE TABLE ledger
      .mockResolvedValueOnce([]) // ledger SELECT
      .mockResolvedValueOnce(undefined) // ledger INSERT
      .mockResolvedValueOnce([{ '?column?': 1 }]); // after

    const db = {
      execute,
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ execute }),
      ),
    };

    const result = await migrateStoreDefaults(db as never);

    expect(result.ok).toBe(true);
    expect(result.tableExistedBefore).toBe(false);
    expect(result.tableExistsAfter).toBe(true);
    expect(result.ddl.statementsRun).toBe(STORE_DEFAULTS_DDL_STATEMENTS.length);
    expect(result.migrationRecord.inserted).toBe(true);
  });

  it('throws — never a false success — when any step fails', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([]) // before
      .mockRejectedValueOnce(new Error('connection reset')); // lock_timeout

    const db = {
      execute,
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ execute }),
      ),
    };

    await expect(migrateStoreDefaults(db as never)).rejects.toThrow(
      'connection reset',
    );
  });
});
