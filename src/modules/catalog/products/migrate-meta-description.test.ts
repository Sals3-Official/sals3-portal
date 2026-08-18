// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  markMigration0021Applied,
  META_DESCRIPTION_DDL_STATEMENT,
  migrateMetaDescription,
  runMetaDescriptionDdl,
} from './migrate-meta-description';

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

describe('runMetaDescriptionDdl', () => {
  it('runs the ADD COLUMN IF NOT EXISTS statement exactly once', async () => {
    const db = { execute: vi.fn().mockResolvedValue(undefined) };

    const result = await runMetaDescriptionDdl(db as never);

    expect(result.statementsRun).toBe(1);
    expect(db.execute).toHaveBeenCalledTimes(1);
    expect(rawStatementText(db.execute.mock.calls[0]?.[0])).toBe(
      META_DESCRIPTION_DDL_STATEMENT,
    );
  });

  it('uses IF NOT EXISTS so a second call over an already-migrated database needs no error tolerance', () => {
    expect(META_DESCRIPTION_DDL_STATEMENT).toContain('IF NOT EXISTS');
  });

  it('does not swallow a real database error', async () => {
    const db = {
      execute: vi.fn().mockRejectedValue(new Error('connection refused')),
    };

    await expect(runMetaDescriptionDdl(db as never)).rejects.toThrow(
      'connection refused',
    );
  });
});

describe('markMigration0021Applied', () => {
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
            rows.filter((row) => row.created_at === 1786964683744),
          );
        }

        rows.push({ hash: 'test-hash', created_at: 1786964683744 });

        return Promise.resolve(undefined);
      }),
    };

    return { db, rows };
  }

  it('inserts a migration record for 0021 on a fresh database', async () => {
    const { db, rows } = fakeMigrationsDb();

    const result = await markMigration0021Applied(db as never);

    expect(result).toEqual({ createdAt: 1786964683744, inserted: true });
    expect(rows).toHaveLength(1);
  });

  it('does not duplicate the record on a second call', async () => {
    const { db, rows } = fakeMigrationsDb();

    await markMigration0021Applied(db as never);
    const second = await markMigration0021Applied(db as never);

    expect(second).toEqual({ createdAt: 1786964683744, inserted: false });
    expect(rows).toHaveLength(1);
  });
});

describe('migrateMetaDescription', () => {
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
            rows.filter((row) => row.created_at === 1786964683744),
          );
        }

        rows.push({ hash: 'test-hash', created_at: 1786964683744 });

        return Promise.resolve(undefined);
      }),
    };

    const result = await migrateMetaDescription(db as never);

    expect(result).toEqual({
      ok: true,
      ddl: { statementsRun: 1 },
      migrationRecord: { createdAt: 1786964683744, inserted: true },
    });
  });
});
