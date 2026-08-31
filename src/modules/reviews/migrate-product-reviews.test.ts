// @vitest-environment node
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
  DDL_LOCK_TIMEOUT,
  DDL_STATEMENTS,
  markMigration0028Applied,
  migrateProductReviews,
  readExistingReviewTables,
  runReviewsDdl,
} from '@/modules/reviews/migrate-product-reviews';

const MIGRATION_0028_CREATED_AT = 1787337923216;

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
  return Object.assign(new Error(`already exists`), { code });
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

describe('runReviewsDdl', () => {
  it('runs every statement, each in its own transaction', async () => {
    const { db } = fakeTransactionalDb();

    const result = await runReviewsDdl(db as never);

    expect(result.statementsRun).toBe(DDL_STATEMENTS.length);
    expect(result.statementsSkippedAlreadyExists).toBe(0);
    expect(db.transaction).toHaveBeenCalledTimes(DDL_STATEMENTS.length);
  });

  /**
   * Three of the six foreign keys reference `sals3_order_lines`, `sals3_orders`,
   * and `products`. `ADD CONSTRAINT ... FOREIGN KEY` takes a SHARE ROW EXCLUSIVE
   * lock on the referenced table, so without a bounded wait this queues paid
   * checkout behind DDL.
   */
  it('bounds the lock wait before every statement', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runReviewsDdl(db as never);

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

    await runReviewsDdl(db as never);

    expect(rawStatementText(execute.mock.calls[0]?.[0])).toContain('SET LOCAL');
  });

  it('runs the statements in the generated order', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runReviewsDdl(db as never);

    const ran = DDL_STATEMENTS.map((_, index) =>
      rawStatementText(execute.mock.calls[index * 2 + 1]?.[0]),
    );

    expect(ran).toEqual(DDL_STATEMENTS);
  });

  it.each([
    ['42710', 'duplicate_object'],
    ['42P07', 'duplicate_table'],
    ['42701', 'duplicate_column'],
  ])('skips a statement whose object already exists (%s %s)', async (code) => {
    const { db } = fakeTransactionalDb(
      vi.fn().mockRejectedValue(alreadyExists(code)),
    );

    const result = await runReviewsDdl(db as never);

    expect(result.statementsRun).toBe(0);
    expect(result.statementsSkippedAlreadyExists).toBe(DDL_STATEMENTS.length);
  });

  /**
   * The shape the bare test above cannot see.
   *
   * `migrate-review-extras` shipped the same naive `error.code` read and its
   * **second** production run answered 500: every `CREATE TYPE` and
   * `ADD CONSTRAINT` raised `duplicate_object`, the check read the code off
   * Drizzle's wrapper, got `undefined`, and rethrew. This module's DDL has two
   * `CREATE TYPE`s and six `ADD CONSTRAINT`s — none of which Postgres lets us
   * guard with `IF NOT EXISTS` — so its documented idempotency stands entirely
   * on reading the code out of `cause`.
   */
  it.each([
    ['42710', 'duplicate_object'],
    ['42P07', 'duplicate_table'],
    ['42701', 'duplicate_column'],
  ])(
    'skips a duplicate Drizzle wrapped, not just a bare one (%s %s)',
    async (code) => {
      const { db } = fakeTransactionalDb(
        vi.fn().mockRejectedValue(wrappedAlreadyExists(code)),
      );

      const result = await runReviewsDdl(db as never);

      expect(result.statementsRun).toBe(0);
      expect(result.statementsSkippedAlreadyExists).toBe(DDL_STATEMENTS.length);
    },
  );

  it('does not swallow a real database error', async () => {
    const { db } = fakeTransactionalDb(
      vi.fn().mockRejectedValue(new Error('connection refused')),
    );

    await expect(runReviewsDdl(db as never)).rejects.toThrow(
      'connection refused',
    );
  });

  /** Walking `cause` must widen what is tolerated, not what is swallowed. */
  it('does not swallow a wrapped error that is not an "already exists"', async () => {
    const { db } = fakeTransactionalDb(
      vi.fn().mockRejectedValue(wrappedAlreadyExists('55P03')),
    );

    await expect(runReviewsDdl(db as never)).rejects.toThrow('Failed query');
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

    await expect(runReviewsDdl(db as never)).rejects.toThrow('lock timeout');
  });
});

describe('DDL_STATEMENTS', () => {
  const CREATABLE = DDL_STATEMENTS.filter(
    (statement) =>
      statement.startsWith('CREATE TABLE') ||
      statement.startsWith('CREATE INDEX') ||
      statement.startsWith('CREATE UNIQUE INDEX'),
  );

  it('uses IF NOT EXISTS everywhere Postgres supports it', () => {
    expect(CREATABLE).not.toHaveLength(0);

    CREATABLE.forEach((statement) => {
      expect(statement).toContain('IF NOT EXISTS');
    });
  });

  /**
   * `CREATE TYPE` and `ALTER TABLE ... ADD CONSTRAINT` have no IF NOT EXISTS
   * form. They are idempotent only through the duplicate_object tolerance in
   * `runReviewsDdl`, so this pins the assumption rather than leaving it implied.
   */
  it('leaves exactly the statements Postgres cannot guard', () => {
    const unguarded = DDL_STATEMENTS.filter(
      (statement) => !statement.includes('IF NOT EXISTS'),
    );

    expect(
      unguarded.every(
        (statement) =>
          statement.startsWith('CREATE TYPE') ||
          statement.startsWith('ALTER TABLE'),
      ),
    ).toBe(true);
  });

  /**
   * The whole review model rests on this one index. Without it a buyer can
   * review the same purchased line repeatedly and move a product's average on
   * one purchase.
   */
  it('creates the one-review-per-order-line unique index', () => {
    const unique = DDL_STATEMENTS.find((statement) =>
      statement.includes('sals3_product_reviews_line_key'),
    );

    expect(unique).toContain('CREATE UNIQUE INDEX');
    expect(unique).toContain('"order_line_id"');
  });

  /** At most one live reply per review, enforced by the database, not the writer. */
  it('creates the single-live-reply partial unique index', () => {
    const unique = DDL_STATEMENTS.find((statement) =>
      statement.includes('sals3_product_review_replies_active_key'),
    );

    expect(unique).toContain('CREATE UNIQUE INDEX');
    expect(unique).toContain(`= 'PUBLISHED'`);
  });

  /**
   * This migration creates tables. It must never alter one an existing writer
   * already touches — that is the hazard `migrate-order-line-snapshot.ts` exists
   * to document, and `order-line-columns.test.ts` pins on the other side.
   */
  it('alters no pre-existing table except to add its own foreign keys', () => {
    const alters = DDL_STATEMENTS.filter((statement) =>
      statement.startsWith('ALTER TABLE'),
    );

    alters.forEach((statement) => {
      expect(statement).toMatch(
        /^ALTER TABLE "sals3_product_review(s|_replies)" ADD CONSTRAINT/,
      );
    });
  });

  /** A review must not be able to outlive the purchase that authorises it. */
  it('keeps every foreign key ON DELETE restrict', () => {
    const keys = DDL_STATEMENTS.filter((statement) =>
      statement.includes('FOREIGN KEY'),
    );

    expect(keys).toHaveLength(6);

    keys.forEach((statement) => {
      expect(statement).toContain('ON DELETE restrict');
    });
  });
});

describe('readExistingReviewTables', () => {
  it('asks information_schema for the real tables, not the migration ledger', async () => {
    const db = {
      execute: vi
        .fn()
        .mockResolvedValue([{ table_name: 'sals3_product_reviews' }]),
    };

    await expect(readExistingReviewTables(db as never)).resolves.toEqual({
      productReviews: true,
      productReviewReplies: false,
    });

    const text = rawStatementText(db.execute.mock.calls[0]?.[0]);

    expect(text).toContain('information_schema.tables');
    expect(text).toContain('sals3_product_reviews');
    expect(text).toContain('sals3_product_review_replies');
  });

  it('reports both absent on an unmigrated database', async () => {
    const db = { execute: vi.fn().mockResolvedValue([]) };

    await expect(readExistingReviewTables(db as never)).resolves.toEqual({
      productReviews: false,
      productReviewReplies: false,
    });
  });
});

describe('migrateProductReviews', () => {
  /**
   * Models a database where the tables genuinely appear once the CREATEs run, so
   * the before/after reads reflect real state rather than a fixed answer.
   */
  function fakeMigratingDb(startsMigrated = false) {
    const rows: { hash: string; created_at: number }[] = [];
    let tablesExist = startsMigrated;

    const execute = vi.fn((query: unknown) => {
      const raw = rawStatementText(query);
      const text = raw.toUpperCase();

      if (text.includes('SET LOCAL')) return Promise.resolve(undefined);

      if (raw.includes('information_schema.tables')) {
        return Promise.resolve(
          tablesExist
            ? [
                { table_name: 'sals3_product_reviews' },
                { table_name: 'sals3_product_review_replies' },
              ]
            : [],
        );
      }

      // Membership, not a pattern: a `CREATE TYPE` names no table, so guessing
      // from the text alone let a DDL statement fall through to the ledger
      // branch below and fake an already-recorded migration.
      if (DDL_STATEMENTS.includes(raw)) {
        if (raw.startsWith('CREATE TABLE')) tablesExist = true;

        return Promise.resolve(undefined);
      }

      if (text.startsWith('CREATE SCHEMA') || text.startsWith('CREATE TABLE')) {
        return Promise.resolve(undefined);
      }

      if (text.startsWith('SELECT')) {
        return Promise.resolve(
          rows.filter((row) => row.created_at === MIGRATION_0028_CREATED_AT),
        );
      }

      rows.push({ hash: 'test-hash', created_at: MIGRATION_0028_CREATED_AT });

      return Promise.resolve(undefined);
    });

    return {
      execute,
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ execute }),
      ),
    };
  }

  it('runs the DDL, records the migration, and proves both tables exist after', async () => {
    const db = fakeMigratingDb();

    const result = await migrateProductReviews(db as never);

    expect(result.ok).toBe(true);
    expect(result.tablesExistedBefore).toEqual({
      productReviews: false,
      productReviewReplies: false,
    });
    expect(result.tablesExistAfter).toEqual({
      productReviews: true,
      productReviewReplies: true,
    });
    expect(result.migrationRecord.inserted).toBe(true);
  });

  /** A re-run against an already-migrated database is a reported no-op, not a failure. */
  it('reports the tables as already present on a second run', async () => {
    const db = fakeMigratingDb(true);

    const result = await migrateProductReviews(db as never);

    expect(result.tablesExistedBefore.productReviews).toBe(true);
    expect(result.tablesExistAfter.productReviewReplies).toBe(true);
  });
});

describe('markMigration0028Applied', () => {
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
            rows.filter((row) => row.created_at === MIGRATION_0028_CREATED_AT),
          );
        }

        rows.push({ hash: 'test-hash', created_at: MIGRATION_0028_CREATED_AT });

        return Promise.resolve(undefined);
      }),
    };

    return { db, rows };
  }

  it('inserts a migration record on a fresh database', async () => {
    const { db, rows } = fakeMigrationsDb();

    await expect(markMigration0028Applied(db as never)).resolves.toEqual({
      createdAt: MIGRATION_0028_CREATED_AT,
      inserted: true,
    });
    expect(rows).toHaveLength(1);
  });

  it('does not duplicate the record on a second call', async () => {
    const { db, rows } = fakeMigrationsDb();

    await markMigration0028Applied(db as never);

    await expect(markMigration0028Applied(db as never)).resolves.toEqual({
      createdAt: MIGRATION_0028_CREATED_AT,
      inserted: false,
    });
    expect(rows).toHaveLength(1);
  });
});

/**
 * The two hard-coded ledger constants describe a file on disk. They are
 * hard-coded so the endpoint never depends on the migration being in the
 * deployed bundle, which means nothing but this test would notice them drifting.
 */
describe('migration ledger constants', () => {
  const MODULE_TEXT = readFileSync(
    'src/modules/reviews/migrate-product-reviews.ts',
    'utf8',
  );
  const MIGRATION_SQL = readFileSync(
    'drizzle/0028_icy_sally_floyd.sql',
    'utf8',
  );

  it('match the migration file and its journal entry', () => {
    const journal = JSON.parse(
      readFileSync('drizzle/meta/_journal.json', 'utf8'),
    ) as { entries: { tag: string; when: number }[] };
    const entry = journal.entries.find(
      (item) => item.tag === '0028_icy_sally_floyd',
    );

    expect(entry?.when).toBe(MIGRATION_0028_CREATED_AT);
    expect(MODULE_TEXT).toContain(String(entry?.when));
    expect(MODULE_TEXT).toContain(
      createHash('sha256').update(MIGRATION_SQL).digest('hex'),
    );
  });

  /**
   * The endpoint's statements are the migration file's content by hand. This is
   * the only thing that notices the two drifting apart.
   */
  it('ships DDL naming every object the migration file creates', () => {
    const objects = [
      'product_review_status',
      'product_review_reply_status',
      'sals3_product_reviews',
      'sals3_product_review_replies',
      'sals3_product_reviews_line_key',
      'sals3_product_reviews_product_idx',
      'sals3_product_reviews_seller_idx',
      'sals3_product_reviews_buyer_idx',
      'sals3_product_review_replies_active_key',
      'sals3_product_review_replies_version_key',
      'sals3_product_review_replies_seller_idx',
    ];
    const joined = DDL_STATEMENTS.join('\n');

    objects.forEach((object) => {
      expect(MIGRATION_SQL).toContain(object);
      expect(joined).toContain(object);
    });
  });

  /** Statement count parity: the file's breakpoints against the endpoint's list. */
  it('ships one DDL statement per statement in the migration file', () => {
    const fileStatements = MIGRATION_SQL.split('--> statement-breakpoint')
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk !== '');

    expect(DDL_STATEMENTS).toHaveLength(fileStatements.length);
  });
});
