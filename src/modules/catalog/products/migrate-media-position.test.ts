// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  DDL_LOCK_TIMEOUT,
  hasMediaPositionColumn,
  markMigration0031Applied,
  migrateMediaPosition,
  runMediaPositionDdl,
  MEDIA_POSITION_DDL_STATEMENTS,
} from './migrate-media-position';

const MIGRATION_0031_CREATED_AT = 1787862669015;

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

describe('runMediaPositionDdl', () => {
  it('runs the ADD COLUMN statement inside one transaction', async () => {
    const { db, execute } = fakeTransactionalDb();

    const result = await runMediaPositionDdl(db as never);

    expect(result.statementsRun).toBe(1);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(rawStatementText(execute.mock.calls[1]?.[0])).toBe(
      MEDIA_POSITION_DDL_STATEMENTS[0],
    );
  });

  /**
   * The ALTER takes an ACCESS EXCLUSIVE lock on `product_media_sources`.
   * Without a bounded wait it queues behind any long query and blocks every
   * catalogue read and media write behind it — the same outage shape as the
   * missing column, with no mid-DDL rollback available.
   */
  it('bounds the ACCESS EXCLUSIVE lock wait before touching the table', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runMediaPositionDdl(db as never);

    const first = rawStatementText(execute.mock.calls[0]?.[0]);

    expect(first).toContain('SET LOCAL lock_timeout');
    expect(first).toContain(DDL_LOCK_TIMEOUT);
  });

  /**
   * `SET LOCAL`, never a session `SET`: this runs on a pooled serverless
   * connection, and a session-level timeout would leak onto whatever unrelated
   * query reuses that connection next.
   */
  it('scopes the timeout to the transaction, not the pooled connection', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runMediaPositionDdl(db as never);

    expect(rawStatementText(execute.mock.calls[0]?.[0])).not.toMatch(
      /^SET lock_timeout/u,
    );
  });

  /**
   * Re-running must be a no-op rather than an error. The route, the workflow,
   * and the "safe to call more than once" promise all rest on this.
   */
  it('is idempotent by construction', () => {
    expect(MEDIA_POSITION_DDL_STATEMENTS).toHaveLength(1);
    expect(MEDIA_POSITION_DDL_STATEMENTS[0]).toContain(
      'ADD COLUMN IF NOT EXISTS',
    );
  });

  /**
   * One additive nullable column. A DROP, a NOT NULL, or a DEFAULT would each
   * make this something other than the safe-in-any-order add it is documented
   * to be — a DEFAULT in particular would rewrite the table under the lock.
   */
  it('adds one nullable column and touches nothing else', () => {
    expect(MEDIA_POSITION_DDL_STATEMENTS[0]).toContain(
      '"product_media_sources"',
    );
    expect(MEDIA_POSITION_DDL_STATEMENTS[0]).toContain('"position" integer');
    expect(MEDIA_POSITION_DDL_STATEMENTS[0]).not.toMatch(
      /DROP|NOT NULL|DEFAULT|source_url/u,
    );
  });
});

describe('hasMediaPositionColumn', () => {
  it('asks information_schema for the real column, not the migration ledger', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([{ column_name: 'position' }]),
    };

    await expect(hasMediaPositionColumn(db as never)).resolves.toBe(true);

    const text = rawStatementText(db.execute.mock.calls[0]?.[0]);

    expect(text).toContain('information_schema.columns');
    expect(text).toContain('position');
    expect(text).toContain('product_media_sources');
  });

  it('reports false when the column is absent', async () => {
    const db = { execute: vi.fn().mockResolvedValue([]) };

    await expect(hasMediaPositionColumn(db as never)).resolves.toBe(false);
  });
});

describe('markMigration0031Applied', () => {
  function ledgerDb() {
    const rows: { hash: string; created_at: number }[] = [];
    const execute = vi.fn(async (query: unknown) => {
      const text = rawStatementText(query);

      if (text.startsWith('SELECT id FROM')) {
        return rows.filter(
          (row) => row.created_at === MIGRATION_0031_CREATED_AT,
        );
      }

      if (text.startsWith('INSERT INTO')) {
        rows.push({ hash: 'test-hash', created_at: MIGRATION_0031_CREATED_AT });
      }

      return undefined;
    });

    return { db: { execute }, rows };
  }

  it('records the migration so a later db:migrate does not re-run it', async () => {
    const { db } = ledgerDb();

    await expect(markMigration0031Applied(db as never)).resolves.toEqual({
      createdAt: MIGRATION_0031_CREATED_AT,
      inserted: true,
    });
  });

  it('is idempotent: a second call inserts nothing', async () => {
    const { db, rows } = ledgerDb();

    await markMigration0031Applied(db as never);

    await expect(markMigration0031Applied(db as never)).resolves.toEqual({
      createdAt: MIGRATION_0031_CREATED_AT,
      inserted: false,
    });
    expect(rows).toHaveLength(1);
  });
});

describe('migrateMediaPosition', () => {
  /**
   * `columnExistsAfter` is re-read from `information_schema` after the DDL, and
   * it is the field an operator should trust. A 200 carrying `false` would mean
   * the run reported success without achieving anything — which is exactly the
   * disagreement between ledger and reality that the 2026-08-18 incident was.
   */
  it('reports the column state from the database, before and after', async () => {
    let columnPresent = false;
    const execute = vi.fn(async (query: unknown) => {
      const text = rawStatementText(query);

      if (text.includes('information_schema.columns')) {
        return columnPresent ? [{ column_name: 'position' }] : [];
      }

      if (text.includes('ADD COLUMN')) columnPresent = true;

      if (text.startsWith('SELECT id FROM')) return [];

      return undefined;
    });
    const db = {
      execute,
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ execute }),
      ),
    };

    await expect(migrateMediaPosition(db as never)).resolves.toMatchObject({
      ok: true,
      columnExistedBefore: false,
      columnExistsAfter: true,
      ddl: { statementsRun: 1 },
    });
  });
});
