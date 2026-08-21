// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  DDL_LOCK_TIMEOUT,
  hasStoredCopyColumns,
  migrateMediaStoredCopy,
  runMediaStoredCopyDdl,
  MEDIA_STORED_COPY_DDL_STATEMENTS,
} from './migrate-media-stored-copy';

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

describe('runMediaStoredCopyDdl', () => {
  it('runs both ADD COLUMN statements inside one transaction', async () => {
    const { db, execute } = fakeTransactionalDb();

    const result = await runMediaStoredCopyDdl(db as never);

    expect(result.statementsRun).toBe(2);
    // One transaction, not two: a table left with `stored_url` and no
    // `stored_at` would make the mirror module's "already stored?" check
    // ambiguous.
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(rawStatementText(execute.mock.calls[1]?.[0])).toBe(
      MEDIA_STORED_COPY_DDL_STATEMENTS[0],
    );
    expect(rawStatementText(execute.mock.calls[2]?.[0])).toBe(
      MEDIA_STORED_COPY_DDL_STATEMENTS[1],
    );
  });

  /**
   * The ALTER takes an ACCESS EXCLUSIVE lock on `products`. Without a bounded
   * wait it queues behind any long query and blocks every read behind it -
   * the same outage shape as the missing column, with no mid-DDL rollback.
   */
  it('bounds the ACCESS EXCLUSIVE lock wait before touching the table', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runMediaStoredCopyDdl(db as never);

    const first = rawStatementText(execute.mock.calls[0]?.[0]);

    expect(first).toContain('SET LOCAL lock_timeout');
    expect(first).toContain(DDL_LOCK_TIMEOUT);
  });

  /** Session-scoped SET would leak onto the next query sharing a pooled connection. */
  it('scopes the timeout to the transaction, never the session', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runMediaStoredCopyDdl(db as never);

    expect(rawStatementText(execute.mock.calls[0]?.[0])).toContain('SET LOCAL');
  });

  it('uses IF NOT EXISTS so a second call needs no error tolerance', () => {
    MEDIA_STORED_COPY_DDL_STATEMENTS.forEach((statement) => {
      expect(statement).toContain('IF NOT EXISTS');
    });
  });

  /**
   * Nullable and defaultless on purpose. A row accepted before this column
   * existed has no snapshot, and the buyer projection has to read that as "this
   * order predates the snapshot" rather than as an empty one — a `DEFAULT
   * '{}'::jsonb` would erase the difference.
   */
  it('adds plain nullable columns, with no default to reason about', () => {
    const combined = MEDIA_STORED_COPY_DDL_STATEMENTS.join(' ');

    expect(combined).toContain('"stored_url"');
    expect(combined).toContain('"stored_at"');
    expect(combined).not.toContain('DEFAULT');
    expect(combined).not.toContain('NOT NULL');
  });

  /** Provenance is not touched: `source_url` stays exactly as recorded. */
  it('never rewrites source_url', () => {
    const combined = MEDIA_STORED_COPY_DDL_STATEMENTS.join(' ');

    expect(combined).toContain('"product_media_sources"');
    expect(combined).not.toContain('source_url');
    expect(combined).not.toMatch(/DROP|RENAME|ALTER COLUMN/u);
  });

  it('does not swallow a real database error', async () => {
    const { db } = fakeTransactionalDb(
      vi.fn().mockRejectedValue(new Error('connection refused')),
    );

    await expect(runMediaStoredCopyDdl(db as never)).rejects.toThrow(
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

    await expect(runMediaStoredCopyDdl(db as never)).rejects.toThrow(
      'lock timeout',
    );
  });
});

describe('hasStoredCopyColumns', () => {
  it('asks information_schema for the real columns, not the migration ledger', async () => {
    const db = {
      execute: vi
        .fn()
        .mockResolvedValue([
          { column_name: 'stored_url' },
          { column_name: 'stored_at' },
        ]),
    };

    await expect(hasStoredCopyColumns(db as never)).resolves.toBe(true);

    const text = rawStatementText(db.execute.mock.calls[0]?.[0]);

    expect(text).toContain('information_schema.columns');
    expect(text).toContain('stored_url');
    expect(text).toContain('stored_at');
    expect(text).toContain('product_media_sources');
  });

  it('reports false when the columns are absent', async () => {
    const db = { execute: vi.fn().mockResolvedValue([]) };

    await expect(hasStoredCopyColumns(db as never)).resolves.toBe(false);
  });

  /**
   * A half-migrated table is not migrated. One column present would otherwise
   * read as done and let the mirror code deploy against a table that cannot
   * record when the copy was taken.
   */
  it('reports false when only one of the two columns exists', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([{ column_name: 'stored_url' }]),
    };

    await expect(hasStoredCopyColumns(db as never)).resolves.toBe(false);
  });
});

describe('migrateMediaStoredCopy', () => {
  /**
   * Models a database where the column genuinely appears once the ALTER runs,
   * so the before/after reads reflect real state rather than a fixed answer.
   */
  function fakeMigratingDb(startsWithColumn = false) {
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
        return Promise.resolve(
          columnExists
            ? [{ column_name: 'stored_url' }, { column_name: 'stored_at' }]
            : [],
        );
      }

      return Promise.resolve(undefined);
    });

    return {
      execute,
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ execute }),
      ),
    };
  }

  it('runs the DDL and proves both columns exist after', async () => {
    const db = fakeMigratingDb();

    const result = await migrateMediaStoredCopy(db as never);

    expect(result).toEqual({
      ok: true,
      columnsExistedBefore: false,
      ddl: { statementsRun: 2 },
      columnsExistAfter: true,
    });
  });

  /** A re-run against an already-migrated database is a reported no-op, not a failure. */
  it('reports the columns as already present on a second run', async () => {
    const db = fakeMigratingDb(true);

    const result = await migrateMediaStoredCopy(db as never);

    expect(result.columnsExistedBefore).toBe(true);
    expect(result.columnsExistAfter).toBe(true);
  });
});
