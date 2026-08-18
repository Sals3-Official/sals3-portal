// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  DDL_LOCK_TIMEOUT,
  hasShowSupplierPhotoColumn,
  markMigration0022Applied,
  migrateShowSupplierPhoto,
  runShowSupplierPhotoDdl,
  SHOW_SUPPLIER_PHOTO_DDL_STATEMENT,
} from './migrate-show-supplier-photo';

const MIGRATION_0022_CREATED_AT = 1787014422342;

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

describe('runShowSupplierPhotoDdl', () => {
  it('runs the ADD COLUMN IF NOT EXISTS statement inside a transaction', async () => {
    const { db, execute } = fakeTransactionalDb();

    const result = await runShowSupplierPhotoDdl(db as never);

    expect(result.statementsRun).toBe(1);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(rawStatementText(execute.mock.calls[1]?.[0])).toBe(
      SHOW_SUPPLIER_PHOTO_DDL_STATEMENT,
    );
  });

  /**
   * The ALTER takes an ACCESS EXCLUSIVE lock on `products`. Without a bounded
   * wait it queues behind any long query and blocks every read behind it -
   * the same outage shape as the missing column, with no mid-DDL rollback.
   */
  it('bounds the ACCESS EXCLUSIVE lock wait before touching the table', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runShowSupplierPhotoDdl(db as never);

    const first = rawStatementText(execute.mock.calls[0]?.[0]);

    expect(first).toContain('SET LOCAL lock_timeout');
    expect(first).toContain(DDL_LOCK_TIMEOUT);
  });

  /** Session-scoped SET would leak onto the next query sharing a pooled connection. */
  it('scopes the timeout to the transaction, never the session', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runShowSupplierPhotoDdl(db as never);

    expect(rawStatementText(execute.mock.calls[0]?.[0])).toContain('SET LOCAL');
  });

  it('uses IF NOT EXISTS so a second call over an already-migrated database needs no error tolerance', () => {
    expect(SHOW_SUPPLIER_PHOTO_DDL_STATEMENT).toContain('IF NOT EXISTS');
  });

  /**
   * The column the editor and read model both depend on. A default of `true`
   * is what keeps every already-live product looking exactly as it did before
   * this migration - the supplier's photo was always shown.
   */
  it('adds the column NOT NULL defaulting to true, matching the pre-existing behaviour', () => {
    expect(SHOW_SUPPLIER_PHOTO_DDL_STATEMENT).toContain('show_supplier_photo');
    expect(SHOW_SUPPLIER_PHOTO_DDL_STATEMENT).toContain('DEFAULT true');
    expect(SHOW_SUPPLIER_PHOTO_DDL_STATEMENT).toContain('NOT NULL');
  });

  it('does not swallow a real database error', async () => {
    const { db } = fakeTransactionalDb(
      vi.fn().mockRejectedValue(new Error('connection refused')),
    );

    await expect(runShowSupplierPhotoDdl(db as never)).rejects.toThrow(
      'connection refused',
    );
  });

  /** A lock it cannot take must surface, not be reported as a successful migration. */
  it('propagates a lock timeout instead of reporting success', async () => {
    const { db } = fakeTransactionalDb(
      vi
        .fn()
        .mockRejectedValue(
          new Error('canceling statement due to lock timeout'),
        ),
    );

    await expect(runShowSupplierPhotoDdl(db as never)).rejects.toThrow(
      'lock timeout',
    );
  });
});

describe('hasShowSupplierPhotoColumn', () => {
  it('asks information_schema for the real column, not the migration ledger', async () => {
    const db = { execute: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };

    await expect(hasShowSupplierPhotoColumn(db as never)).resolves.toBe(true);

    const text = rawStatementText(db.execute.mock.calls[0]?.[0]);

    expect(text).toContain('information_schema.columns');
    expect(text).toContain('show_supplier_photo');
  });

  it('reports false when the column is absent', async () => {
    const db = { execute: vi.fn().mockResolvedValue([]) };

    await expect(hasShowSupplierPhotoColumn(db as never)).resolves.toBe(false);
  });
});

describe('markMigration0022Applied', () => {
  function fakeMigrationsDb() {
    const rows: { hash: string; created_at: number }[] = [];

    const db = {
      execute: vi.fn((query: unknown) => {
        const text = rawStatementText(query).toUpperCase();

        if (
          text.startsWith('CREATE SCHEMA') ||
          text.startsWith('CREATE TABLE')
        ) {
          return Promise.resolve(undefined);
        }

        if (text.startsWith('SELECT')) {
          return Promise.resolve(
            rows.filter((row) => row.created_at === MIGRATION_0022_CREATED_AT),
          );
        }

        rows.push({
          hash: 'test-hash',
          created_at: MIGRATION_0022_CREATED_AT,
        });

        return Promise.resolve(undefined);
      }),
    };

    return { db, rows };
  }

  it('inserts a migration record for 0022 on a fresh database', async () => {
    const { db, rows } = fakeMigrationsDb();

    const result = await markMigration0022Applied(db as never);

    expect(result).toEqual({
      createdAt: MIGRATION_0022_CREATED_AT,
      inserted: true,
    });
    expect(rows).toHaveLength(1);
  });

  it('does not duplicate the record on a second call', async () => {
    const { db, rows } = fakeMigrationsDb();

    await markMigration0022Applied(db as never);
    const second = await markMigration0022Applied(db as never);

    expect(second).toEqual({
      createdAt: MIGRATION_0022_CREATED_AT,
      inserted: false,
    });
    expect(rows).toHaveLength(1);
  });
});

describe('migrateShowSupplierPhoto', () => {
  /**
   * Models a database where the column genuinely appears once the ALTER runs,
   * so the before/after reads reflect real state rather than a fixed answer.
   */
  function fakeMigratingDb(startsWithColumn = false) {
    const rows: { hash: string; created_at: number }[] = [];
    let columnExists = startsWithColumn;

    const execute = vi.fn((query: unknown) => {
      const raw = rawStatementText(query);
      const text = raw.toUpperCase();

      if (text.includes('SET LOCAL')) return Promise.resolve(undefined);

      if (text.startsWith('ALTER TABLE')) {
        columnExists = true;

        return Promise.resolve(undefined);
      }

      if (raw.includes('information_schema.columns')) {
        return Promise.resolve(columnExists ? [{ present: 1 }] : []);
      }

      if (text.startsWith('CREATE SCHEMA') || text.startsWith('CREATE TABLE')) {
        return Promise.resolve(undefined);
      }

      if (text.startsWith('SELECT')) {
        return Promise.resolve(
          rows.filter((row) => row.created_at === MIGRATION_0022_CREATED_AT),
        );
      }

      rows.push({ hash: 'test-hash', created_at: MIGRATION_0022_CREATED_AT });

      return Promise.resolve(undefined);
    });

    return {
      execute,
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ execute }),
      ),
    };
  }

  it('runs the DDL, records the migration, and proves the column exists after', async () => {
    const db = fakeMigratingDb();

    const result = await migrateShowSupplierPhoto(db as never);

    expect(result).toEqual({
      ok: true,
      columnExistedBefore: false,
      ddl: { statementsRun: 1 },
      migrationRecord: {
        createdAt: MIGRATION_0022_CREATED_AT,
        inserted: true,
      },
      columnExistsAfter: true,
    });
  });

  /** A re-run against an already-migrated database is a reported no-op, not a failure. */
  it('reports the column as already present on a second run', async () => {
    const db = fakeMigratingDb(true);

    const result = await migrateShowSupplierPhoto(db as never);

    expect(result.columnExistedBefore).toBe(true);
    expect(result.columnExistsAfter).toBe(true);
  });
});
