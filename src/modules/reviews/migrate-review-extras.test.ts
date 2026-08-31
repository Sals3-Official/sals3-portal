// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DDL_LOCK_TIMEOUT,
  DDL_STATEMENTS,
  markMigration0035Applied,
  migrateReviewExtras,
  readReviewExtrasPresence,
  runReviewExtrasDdl,
} from '@/modules/reviews/migrate-review-extras';

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

function alreadyExists(code: string): Error & { code: string } {
  return Object.assign(new Error('already exists'), { code });
}

/**
 * What the driver error actually looks like by the time it reaches us.
 *
 * Drizzle wraps every query error in a `DrizzleQueryError` and hangs the
 * original off `cause`, so `error.code` on the thrown object is `undefined`.
 * The bare shape above is what a test invents; this is what production throws.
 */
function wrappedAlreadyExists(code: string): Error {
  return new Error('Failed query: CREATE TYPE …', {
    cause: alreadyExists(code),
  });
}

describe('DDL_STATEMENTS', () => {
  /**
   * The whole reason this migration is a separate deployment. A schema column
   * would make `submitReview` name `delivery_rating` in its INSERT before the
   * database has it — the PR #102 / #113 mechanism.
   */
  it('adds the delivery rating as a nullable column', () => {
    const alter = DDL_STATEMENTS.find((statement) =>
      statement.includes('ADD COLUMN IF NOT EXISTS "delivery_rating"'),
    );

    expect(alter).toBeDefined();
    expect(alter).toContain('smallint');
    // An absent delivery score is "not answered", never "answered nought".
    expect(alter).not.toContain('NOT NULL');
    expect(alter).not.toContain('DEFAULT');
  });

  it('keeps a delivery rating inside 1-5 when one is given', () => {
    const check = DDL_STATEMENTS.find((statement) =>
      statement.includes('sals3_product_reviews_delivery_rating_range'),
    );

    expect(check).toBeDefined();
    expect(check).toContain('is null or');
    expect(check).toContain('between 1 and 5');
  });

  /** One report per reporter per review, or a queue count is not a count of people. */
  it('makes a second report from the same buyer impossible', () => {
    const index = DDL_STATEMENTS.find((statement) =>
      statement.includes('sals3_product_review_flags_reporter_key'),
    );

    expect(index).toContain('CREATE UNIQUE INDEX');
    expect(index).toContain('"review_id","reporter_email"');
  });

  it('refuses a resolved flag with no decision date, and the reverse', () => {
    const check = DDL_STATEMENTS.find((statement) =>
      statement.includes('sals3_product_review_flags_resolution_stamped'),
    );

    expect(check).toContain(`= 'OPEN'`);
    expect(check).toContain('"resolved_at" is null');
  });

  it('bounds a review to four photos, in a fixed order', () => {
    const table = DDL_STATEMENTS.find((statement) =>
      statement.includes(
        'CREATE TABLE IF NOT EXISTS "sals3_product_review_photos"',
      ),
    );
    const index = DDL_STATEMENTS.find((statement) =>
      statement.includes('sals3_product_review_photos_position_key'),
    );

    expect(table).toContain('"position" between 0 and 3');
    expect(index).toContain('CREATE UNIQUE INDEX');
    expect(index).toContain('"review_id","position"');
  });

  /** Types before tables, tables before keys and indexes. */
  it('orders the statements by dependency', () => {
    const at = (needle: string) =>
      DDL_STATEMENTS.findIndex((statement) => statement.includes(needle));

    expect(
      at('CREATE TYPE "public"."product_review_flag_reason"'),
    ).toBeLessThan(
      at('CREATE TABLE IF NOT EXISTS "sals3_product_review_flags"'),
    );
    expect(
      at('CREATE TABLE IF NOT EXISTS "sals3_product_review_flags"'),
    ).toBeLessThan(at('sals3_product_review_flags_review_id_'));
    expect(
      at('CREATE TABLE IF NOT EXISTS "sals3_product_review_photos"'),
    ).toBeLessThan(at('sals3_product_review_photos_position_key'));
  });

  /**
   * `CREATE TYPE` and `ADD CONSTRAINT` have no `IF NOT EXISTS` in Postgres and
   * lean on the duplicate-object tolerance instead. Everything that *can* carry
   * it must, or a re-run stops being a no-op.
   */
  it('makes every creatable object idempotent on its own', () => {
    DDL_STATEMENTS.filter(
      (statement) =>
        statement.startsWith('CREATE TABLE') ||
        statement.startsWith('CREATE INDEX') ||
        statement.startsWith('CREATE UNIQUE INDEX'),
    ).forEach((statement) => {
      expect(statement).toContain('IF NOT EXISTS');
    });
  });
});

describe('runReviewExtrasDdl', () => {
  it('runs every statement, each in its own transaction', async () => {
    const { db } = fakeTransactionalDb();

    const result = await runReviewExtrasDdl(db as never);

    expect(result.statementsRun).toBe(DDL_STATEMENTS.length);
    expect(result.statementsSkippedAlreadyExists).toBe(0);
    expect(db.transaction).toHaveBeenCalledTimes(DDL_STATEMENTS.length);
  });

  /**
   * The ALTER takes an ACCESS EXCLUSIVE lock on `sals3_product_reviews` and both
   * foreign keys take SHARE ROW EXCLUSIVE on that same table. Without a bounded
   * wait, the product page's review read queues behind DDL.
   */
  it('bounds the lock wait before every statement', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runReviewExtrasDdl(db as never);

    // Two calls per statement: the SET LOCAL, then the DDL itself.
    expect(execute).toHaveBeenCalledTimes(DDL_STATEMENTS.length * 2);

    for (let index = 0; index < DDL_STATEMENTS.length; index += 1) {
      const guard = rawStatementText(execute.mock.calls[index * 2]?.[0]);

      expect(guard).toContain('SET LOCAL lock_timeout');
      expect(guard).toContain(DDL_LOCK_TIMEOUT);
    }
  });

  /** Session-scoped SET would leak onto the next query sharing a pooled connection. */
  it('scopes the timeout to the transaction, never the session', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runReviewExtrasDdl(db as never);

    expect(rawStatementText(execute.mock.calls[0]?.[0])).toContain('SET LOCAL');
  });

  it('runs the statements in the declared order', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runReviewExtrasDdl(db as never);

    DDL_STATEMENTS.forEach((statement, index) => {
      expect(rawStatementText(execute.mock.calls[index * 2 + 1]?.[0])).toBe(
        statement,
      );
    });
  });

  it.each([
    ['42710', 'duplicate_object'],
    ['42P07', 'duplicate_table'],
    ['42701', 'duplicate_column'],
  ])('skips %s (%s) and keeps going', async (code) => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(alreadyExists(code))
      .mockResolvedValue(undefined);
    const { db } = fakeTransactionalDb(execute);

    const result = await runReviewExtrasDdl(db as never);

    expect(result.statementsSkippedAlreadyExists).toBe(1);
    expect(result.statementsRun).toBe(DDL_STATEMENTS.length - 1);
  });

  /**
   * The regression behind a real 500.
   *
   * The first production run of this migration passed because nothing threw.
   * The **second** — the one that records the ledger row — answered 500: every
   * `CREATE TYPE` and `ADD CONSTRAINT` raised `duplicate_object`, the check read
   * `error.code` off Drizzle's wrapper, got `undefined`, and rethrew. An
   * idempotency claim that has only ever been exercised once is not one.
   */
  it('tolerates a duplicate Drizzle wrapped, not just a bare one', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(wrappedAlreadyExists('42710'))
      .mockResolvedValue(undefined);
    const { db } = fakeTransactionalDb(execute);

    const result = await runReviewExtrasDdl(db as never);

    expect(result.statementsSkippedAlreadyExists).toBe(1);
    expect(result.statementsRun).toBe(DDL_STATEMENTS.length - 1);
  });

  /**
   * A lock timeout is not an "already there" — it means nothing was applied and
   * the operator has to decide when to retry. Swallowing it would report success
   * for a run that achieved less than it says.
   */
  it('aborts on a lock timeout rather than continuing', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(wrappedAlreadyExists('55P03'));
    const { db } = fakeTransactionalDb(execute);

    await expect(runReviewExtrasDdl(db as never)).rejects.toThrow();
  });
});

describe('readReviewExtrasPresence', () => {
  it('reports each object independently', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ table_name: 'sals3_product_review_flags' }])
      .mockResolvedValueOnce([{ '?column?': 1 }]);

    await expect(
      readReviewExtrasPresence({ execute } as never),
    ).resolves.toEqual({
      deliveryRatingColumn: true,
      flagsTable: true,
      photosTable: false,
    });
  });

  it('asks information_schema, never the migration ledger', async () => {
    const execute = vi.fn().mockResolvedValue([]);

    await readReviewExtrasPresence({ execute } as never);

    const asked = execute.mock.calls
      .map((call) => rawStatementText(call[0]))
      .join('\n');

    expect(asked).toContain('information_schema.tables');
    expect(asked).toContain('information_schema.columns');
    expect(asked).not.toContain('__drizzle_migrations');
  });
});

describe('migrateReviewExtras', () => {
  /**
   * The field an operator is meant to trust. A 200 whose `presentAfter` still
   * carries a `false` is the false confidence this whole pattern exists to undo.
   */
  it('re-reads reality after the DDL rather than assuming it', async () => {
    // Keyed on the statement rather than a call index: the DDL is what runs in
    // between, and a test that counts calls breaks every time one is added.
    let ddlHasRun = false;
    const execute = vi.fn(async (query: unknown) => {
      const text = rawStatementText(query);

      if (text.includes('information_schema.tables')) {
        return ddlHasRun
          ? [
              { table_name: 'sals3_product_review_flags' },
              { table_name: 'sals3_product_review_photos' },
            ]
          : [];
      }

      if (text.includes('information_schema.columns')) {
        return ddlHasRun ? [{ '?column?': 1 }] : [];
      }

      if (text.includes('sals3_product_review_photos_review_idx')) {
        ddlHasRun = true;
      }

      // The ledger lookup, between the DDL and the "after" reads.
      if (text.includes('__drizzle_migrations')) return [];

      return undefined;
    });
    const { db } = fakeTransactionalDb(execute);

    const result = await migrateReviewExtras(db as never);

    expect(result.presentBefore).toEqual({
      deliveryRatingColumn: false,
      flagsTable: false,
      photosTable: false,
    });
    expect(result.presentAfter).toEqual({
      deliveryRatingColumn: true,
      flagsTable: true,
      photosTable: true,
    });
  });
});

describe('markMigration0035Applied', () => {
  /**
   * The one thing a hard-coded hash can get wrong. Derived from the file the
   * same way `readMigrationFiles()` derives it, so a regenerated migration whose
   * constant was not updated fails here rather than silently recording a ledger
   * row for a file that no longer matches.
   */
  it('matches the migration file it claims to record', () => {
    const sql = readFileSync('drizzle/0035_icy_risque.sql').toString();
    const journal = JSON.parse(
      readFileSync('drizzle/meta/_journal.json').toString(),
    ) as { entries: { tag: string; when: number }[] };

    const entry = journal.entries.find(
      (candidate) => candidate.tag === '0035_icy_risque',
    );

    expect(entry?.when).toBe(1788182483646);
    expect(createHash('sha256').update(sql).digest('hex')).toBe(
      'c6621dcf81ac7a878284a9cbd0d58732600b20d79a1b925a01825ba0b6cc4471',
    );
  });

  it('inserts once and never twice', async () => {
    const execute = vi.fn(async (query: unknown) =>
      rawStatementText(query).startsWith('SELECT id FROM')
        ? [{ id: 7 }]
        : undefined,
    );

    await expect(
      markMigration0035Applied({ execute } as never),
    ).resolves.toEqual({ createdAt: 1788182483646, inserted: false });

    expect(
      execute.mock.calls.some((call) =>
        rawStatementText(call[0]).startsWith('INSERT INTO'),
      ),
    ).toBe(false);
  });
});
