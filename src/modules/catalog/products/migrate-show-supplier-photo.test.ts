// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
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

describe('runShowSupplierPhotoDdl', () => {
  it('runs the ADD COLUMN IF NOT EXISTS statement exactly once', async () => {
    const db = { execute: vi.fn().mockResolvedValue(undefined) };

    const result = await runShowSupplierPhotoDdl(db as never);

    expect(result.statementsRun).toBe(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(rawStatementText(db.execute.mock.calls[0]?.[0])).toBe(
      SHOW_SUPPLIER_PHOTO_DDL_STATEMENT,
    );
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
    const db = {
      execute: vi.fn().mockRejectedValue(new Error('connection refused')),
    };

    await expect(runShowSupplierPhotoDdl(db as never)).rejects.toThrow(
      'connection refused',
    );
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
  it('runs the DDL then records the migration, and reports both results', async () => {
    const rows: { hash: string; created_at: number }[] = [];
    const db = {
      execute: vi.fn((query: unknown) => {
        const text = rawStatementText(query).toUpperCase();

        if (text.startsWith('ALTER TABLE')) return Promise.resolve(undefined);
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

    const result = await migrateShowSupplierPhoto(db as never);

    expect(result).toEqual({
      ok: true,
      ddl: { statementsRun: 1 },
      migrationRecord: {
        createdAt: MIGRATION_0022_CREATED_AT,
        inserted: true,
      },
    });
  });
});
