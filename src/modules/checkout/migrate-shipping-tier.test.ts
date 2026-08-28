// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import {
  DDL_LOCK_TIMEOUT,
  hasShippingTierColumn,
  hasShippingTierConstraint,
  markMigration0032Applied,
  migrateShippingTier,
  runShippingTierDdl,
  SHIPPING_TIER_COLUMN_DDL_STATEMENT,
  SHIPPING_TIER_CONSTRAINT_DDL_STATEMENT,
} from './migrate-shipping-tier';

const MIGRATION_0032_CREATED_AT = 1787892991698;

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

describe('runShippingTierDdl', () => {
  it('adds the column and its constraint inside one transaction', async () => {
    const { db, execute } = fakeTransactionalDb();

    const result = await runShippingTierDdl(db as never);

    expect(result.statementsRun).toBe(2);
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(rawStatementText(execute.mock.calls[1]?.[0])).toBe(
      SHIPPING_TIER_COLUMN_DDL_STATEMENT,
    );
    expect(rawStatementText(execute.mock.calls[2]?.[0])).toBe(
      SHIPPING_TIER_CONSTRAINT_DDL_STATEMENT,
    );
  });

  /**
   * The ALTER takes an ACCESS EXCLUSIVE lock on `fulfillment_groups`. Without
   * a bounded wait it queues behind any long query and blocks every order read
   * behind it, with no mid-DDL rollback.
   */
  it('bounds the ACCESS EXCLUSIVE lock wait before touching the table', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runShippingTierDdl(db as never);

    const first = rawStatementText(execute.mock.calls[0]?.[0]);

    expect(first).toContain('SET LOCAL lock_timeout');
    expect(first).toContain(DDL_LOCK_TIMEOUT);
  });

  /** Session-scoped SET would leak onto the next query sharing a pooled connection. */
  it('scopes the timeout to the transaction, never the session', async () => {
    const { db, execute } = fakeTransactionalDb();

    await runShippingTierDdl(db as never);

    expect(rawStatementText(execute.mock.calls[0]?.[0])).toContain('SET LOCAL');
  });

  /** A second run must be a no-op, not `column already exists`. */
  it('adds the column only when it is absent', () => {
    expect(SHIPPING_TIER_COLUMN_DDL_STATEMENT).toContain(
      'ADD COLUMN IF NOT EXISTS',
    );
  });

  /**
   * Postgres has no ADD CONSTRAINT IF NOT EXISTS, so the guard is hand-written.
   * Without it the retry story is worse than the migration it protects.
   */
  it('guards the constraint against a second run', () => {
    expect(SHIPPING_TIER_CONSTRAINT_DDL_STATEMENT).toContain(
      'IF NOT EXISTS (\n    SELECT 1 FROM pg_constraint',
    );
    expect(SHIPPING_TIER_CONSTRAINT_DDL_STATEMENT).toContain(
      'fulfillment_groups_shipping_tier_check',
    );
  });

  /**
   * Orders accepted before this migration have no tier. A constraint that
   * rejected null would reject every one of them.
   */
  it('admits null so pre-tier orders are not rejected', () => {
    expect(SHIPPING_TIER_CONSTRAINT_DDL_STATEMENT).toContain('is null');
  });

  it('restricts the column to the three tier names', () => {
    expect(SHIPPING_TIER_CONSTRAINT_DDL_STATEMENT).toContain(
      "in ('Standard', 'Express', 'Expedited')",
    );
  });

  /** A default would hand every pre-tier order the same invented promise. */
  it('adds no default', () => {
    expect(SHIPPING_TIER_COLUMN_DDL_STATEMENT).not.toContain('DEFAULT');
    expect(SHIPPING_TIER_COLUMN_DDL_STATEMENT).not.toContain('NOT NULL');
  });
});

describe('hasShippingTierColumn', () => {
  it('asks information_schema rather than the migration ledger', async () => {
    const execute = vi.fn().mockResolvedValue([{ '?column?': 1 }]);

    await expect(hasShippingTierColumn({ execute } as never)).resolves.toBe(
      true,
    );

    const text = rawStatementText(execute.mock.calls[0]?.[0]);

    expect(text).toContain('information_schema.columns');
    expect(text).toContain('fulfillment_groups');
    expect(text).toContain('shipping_tier');
  });

  it('reports absence as false', async () => {
    const execute = vi.fn().mockResolvedValue([]);

    await expect(hasShippingTierColumn({ execute } as never)).resolves.toBe(
      false,
    );
  });
});

describe('hasShippingTierConstraint', () => {
  it('asks pg_constraint by name', async () => {
    const execute = vi.fn().mockResolvedValue([{ '?column?': 1 }]);

    await expect(hasShippingTierConstraint({ execute } as never)).resolves.toBe(
      true,
    );
    expect(rawStatementText(execute.mock.calls[0]?.[0])).toContain(
      'pg_constraint',
    );
  });

  it('reports absence as false', async () => {
    const execute = vi.fn().mockResolvedValue([]);

    await expect(hasShippingTierConstraint({ execute } as never)).resolves.toBe(
      false,
    );
  });
});

describe('markMigration0032Applied', () => {
  it('inserts the ledger row when 0032 is not recorded yet', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(undefined) // CREATE SCHEMA
      .mockResolvedValueOnce(undefined) // CREATE TABLE
      .mockResolvedValueOnce([]) // SELECT existing
      .mockResolvedValueOnce(undefined); // INSERT

    const result = await markMigration0032Applied({ execute } as never);

    expect(result).toEqual({
      createdAt: MIGRATION_0032_CREATED_AT,
      inserted: true,
    });
    expect(rawStatementText(execute.mock.calls[3]?.[0])).toContain('INSERT');
  });

  it('writes nothing when the row is already there', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([{ id: 1 }]);

    const result = await markMigration0032Applied({ execute } as never);

    expect(result).toEqual({
      createdAt: MIGRATION_0032_CREATED_AT,
      inserted: false,
    });
    expect(execute).toHaveBeenCalledTimes(3);
  });
});

describe('migrateShippingTier', () => {
  /**
   * The before/after reads are what make this operation checkable rather than
   * trusted: the workflow asserts on `columnExistsAfter`, not on HTTP 200.
   */
  it('reports the schema state on both sides of the DDL', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([]) // column before: absent
      .mockResolvedValueOnce([]) // constraint before: absent
      .mockResolvedValue(undefined);
    const db = {
      execute,
      transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
        callback({ execute: vi.fn().mockResolvedValue(undefined) }),
      ),
    };

    // After the DDL and the ledger writes, both reads report present.
    execute.mockResolvedValueOnce(undefined); // CREATE SCHEMA
    execute.mockResolvedValueOnce(undefined); // CREATE TABLE
    execute.mockResolvedValueOnce([]); // SELECT existing
    execute.mockResolvedValueOnce(undefined); // INSERT
    execute.mockResolvedValueOnce([{ '?column?': 1 }]); // column after
    execute.mockResolvedValueOnce([{ '?column?': 1 }]); // constraint after

    const result = await migrateShippingTier(db as never);

    expect(result.ok).toBe(true);
    expect(result.columnExistedBefore).toBe(false);
    expect(result.constraintExistedBefore).toBe(false);
    expect(result.columnExistsAfter).toBe(true);
    expect(result.constraintExistsAfter).toBe(true);
  });

  /** A step that throws must surface as a 500, never as a false success. */
  it('propagates a failed DDL rather than reporting ok', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = {
      execute,
      transaction: vi.fn(async () => {
        throw new Error('canceling statement due to lock timeout');
      }),
    };

    await expect(migrateShippingTier(db as never)).rejects.toThrow(
      'lock timeout',
    );
  });
});
