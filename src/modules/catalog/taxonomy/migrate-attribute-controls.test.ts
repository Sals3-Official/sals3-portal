// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  extract: {
    source: {
      workbook: 'universal_category_variation_taxonomy_final_clean.xlsx',
      sha256: 'checksum-abc',
    },
    controlsVersion: 'sals3-attribute-controls-v1',
    dictionary: [
      {
        attributeName: 'Brand',
        canonicalAttributeKey: 'BRAND',
        defaultInputControlType: 'SINGLE_SELECT_DROPDOWN',
        defaultAllowedValues: ['UNBRANDED'],
        defaultAllowCustomValue: true,
        defaultAllowMultipleValues: false,
        dataType: 'STRING',
        notes: null,
      },
    ],
    controls: [
      {
        categoryCode: 'CAT-GGL-1',
        attributeName: 'Brand',
        requirementLevel: 'REQUIRED',
        inputControlType: 'SINGLE_SELECT_DROPDOWN',
        allowedValues: ['UNBRANDED'],
        allowCustomValue: true,
        allowMultipleValues: false,
        sellerHelpText: null,
        seoVisibility: 'STRUCTURED_DATA_ELIGIBLE',
        aeoGeoVisibility: 'ANSWER_SUMMARY_USEFUL',
        complianceReviewFlag: 'STANDARD_CATALOG_REVIEW',
        sourceBasis: 'Core marketplace mandatory brand identifier',
      },
      {
        categoryCode: 'CAT-GGL-DOES-NOT-EXIST',
        attributeName: 'Brand',
        requirementLevel: 'REQUIRED',
        inputControlType: 'SINGLE_SELECT_DROPDOWN',
        allowedValues: ['UNBRANDED'],
        allowCustomValue: true,
        allowMultipleValues: false,
        sellerHelpText: null,
        seoVisibility: 'STRUCTURED_DATA_ELIGIBLE',
        aeoGeoVisibility: 'ANSWER_SUMMARY_USEFUL',
        complianceReviewFlag: 'STANDARD_CATALOG_REVIEW',
        sourceBasis: 'Core marketplace mandatory brand identifier',
      },
    ],
  },
}));

vi.mock('@/lib/db/seed-data/sals3-category-attribute-controls-v1.json', () => ({
  default: mocks.extract,
}));

/* eslint-disable import/first */
import {
  DDL_STATEMENTS,
  markMigration0020Applied,
  migrateAttributeControls,
  runAttributeControlsDdl,
  seedAttributeControlsData,
} from './migrate-attribute-controls';
/* eslint-enable import/first */

/** Recovers the literal SQL text passed to `sql.raw(...)`, for test doubles that need to branch on statement type. */
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

describe('runAttributeControlsDdl', () => {
  it('runs every statement and reports none skipped on a fresh database', async () => {
    const db = { execute: vi.fn().mockResolvedValue(undefined) };

    const result = await runAttributeControlsDdl(db as never);

    expect(result.statementsSkippedAlreadyExists).toBe(0);
    expect(result.statementsRun).toBe(DDL_STATEMENTS.length);
    expect(db.execute).toHaveBeenCalledTimes(DDL_STATEMENTS.length);
  });

  it('tolerates "already exists" on every statement, for a second call over an already-migrated environment', async () => {
    const alreadyExists = Object.assign(new Error('already exists'), {
      code: '42710',
    });
    const db = { execute: vi.fn().mockRejectedValue(alreadyExists) };

    const result = await runAttributeControlsDdl(db as never);

    expect(result.statementsRun).toBe(0);
    expect(result.statementsSkippedAlreadyExists).toBe(DDL_STATEMENTS.length);
  });

  /**
   * The shape the bare test above cannot see.
   *
   * Drizzle wraps every query error in a `DrizzleQueryError` and hangs the
   * original off `cause`, so `error.code` on the thrown object is `undefined`.
   * `migrate-review-extras` shipped that naive read and its **second**
   * production run answered 500 — every `CREATE TYPE` and `ADD CONSTRAINT`
   * raised `duplicate_object` and was rethrown by the check that exists to
   * tolerate it. This module has six `CREATE TYPE`s and three
   * `ADD CONSTRAINT`s, none of which Postgres lets us guard with
   * `IF NOT EXISTS`, so its second-call safety stands entirely on reading the
   * code out of `cause`.
   */
  it.each(['42710', '42P07', '42701'])(
    'tolerates a duplicate Drizzle wrapped, not just a bare one (%s)',
    async (code) => {
      const wrapped = new Error('Failed query: CREATE TYPE …', {
        cause: Object.assign(new Error('already exists'), { code }),
      });
      const db = { execute: vi.fn().mockRejectedValue(wrapped) };

      const result = await runAttributeControlsDdl(db as never);

      expect(result.statementsRun).toBe(0);
      expect(result.statementsSkippedAlreadyExists).toBe(DDL_STATEMENTS.length);
    },
  );

  it('does not swallow an unrelated error', async () => {
    const db = {
      execute: vi.fn().mockRejectedValue(new Error('connection refused')),
    };

    await expect(runAttributeControlsDdl(db as never)).rejects.toThrow(
      'connection refused',
    );
  });

  /** Walking `cause` must widen what is tolerated, not what is swallowed. */
  it('does not swallow a wrapped error that is not an "already exists"', async () => {
    const wrapped = new Error('Failed query: ALTER TABLE …', {
      cause: Object.assign(new Error('deadlock detected'), { code: '40P01' }),
    });
    const db = { execute: vi.fn().mockRejectedValue(wrapped) };

    await expect(runAttributeControlsDdl(db as never)).rejects.toThrow(
      'Failed query',
    );
  });
});

describe('markMigration0020Applied', () => {
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
            rows.filter((row) => row.created_at === 1786935292882),
          );
        }

        rows.push({ hash: 'test-hash', created_at: 1786935292882 });

        return Promise.resolve(undefined);
      }),
    };

    return { db, rows };
  }

  it('inserts a migration record for 0020 on a fresh database', async () => {
    const { db, rows } = fakeMigrationsDb();

    const result = await markMigration0020Applied(db as never);

    expect(result).toEqual({ createdAt: 1786935292882, inserted: true });
    expect(rows).toHaveLength(1);
  });

  it('does not duplicate the record on a second call', async () => {
    const { db, rows } = fakeMigrationsDb();

    await markMigration0020Applied(db as never);
    const second = await markMigration0020Applied(db as never);

    expect(second).toEqual({ createdAt: 1786935292882, inserted: false });
    expect(rows).toHaveLength(1);
  });
});

describe('seedAttributeControlsData', () => {
  function fakeDb(options: { categoryRows: { id: string; code: string }[] }) {
    const inserts: { table: unknown; values: unknown; onConflict?: unknown }[] =
      [];

    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => Promise.resolve(options.categoryRows)),
      })),
      insert: vi.fn((table: unknown) => {
        const chain: Record<string, unknown> = {};

        chain.values = vi.fn((values: unknown) => {
          inserts.push({ table, values });

          return chain;
        });
        chain.onConflictDoNothing = vi.fn((config: unknown) => {
          const last = inserts[inserts.length - 1];

          if (last !== undefined) last.onConflict = config;

          return chain;
        });
        chain.returning = vi.fn(() =>
          Promise.resolve(
            (inserts[inserts.length - 1]?.values as unknown[]).map(() => ({
              id: 'row-id',
            })),
          ),
        );

        return chain;
      }),
    };

    return { db, inserts };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed and inserts nothing into either table when the extract references a category code the database does not have', async () => {
    const { db, inserts } = fakeDb({
      categoryRows: [{ id: 'category-1', code: 'CAT-GGL-1' }],
    });

    const result = await seedAttributeControlsData(db as never);

    expect(result).toEqual({
      ok: false,
      reason: 'missing-category-codes',
      missingCategoryCodeCount: 1,
      missingCategoryCodesSample: ['CAT-GGL-DOES-NOT-EXIST'],
    });
    expect(inserts).toHaveLength(0);
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('inserts the dictionary and controls with onConflictDoNothing on each table’s natural unique key once every category code resolves', async () => {
    const { db, inserts } = fakeDb({
      categoryRows: [
        { id: 'category-1', code: 'CAT-GGL-1' },
        { id: 'category-2', code: 'CAT-GGL-DOES-NOT-EXIST' },
      ],
    });

    const result = await seedAttributeControlsData(db as never);

    expect(result.ok).toBe(true);

    const dictionaryInsert = inserts.find(
      (entry) =>
        (entry.values as { attributeName?: string }[])[0]?.attributeName ===
          'Brand' &&
        (entry.values as unknown[]).length === 1 &&
        'canonicalAttributeKey' in
          (entry.values as Record<string, unknown>[])[0],
    );
    const controlsInsert = inserts.find(
      (entry) =>
        'categoryId' in ((entry.values as Record<string, unknown>[])[0] ?? {}),
    );

    expect(dictionaryInsert?.onConflict).toBeDefined();
    expect(controlsInsert?.onConflict).toBeDefined();
  });

  it('reports exact extract sizes so a caller can confirm nothing silently dropped', async () => {
    const { db } = fakeDb({
      categoryRows: [
        { id: 'category-1', code: 'CAT-GGL-1' },
        { id: 'category-2', code: 'CAT-GGL-DOES-NOT-EXIST' },
      ],
    });

    const result = await seedAttributeControlsData(db as never);

    if (!result.ok) throw new Error('expected an ok result');
    expect(result.dictionaryInExtract).toBe(1);
    expect(result.controlsVersion).toBe('sals3-attribute-controls-v1');
    expect(result.controlsInExtract).toBe(2);
    expect(result.controlsInserted).toBe(2);
  });
});

describe('migrateAttributeControls', () => {
  it('runs the DDL, then marks 0020 applied, then seeds - in that order - on success', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([]),
      select: vi.fn(() => ({
        from: vi.fn(() =>
          Promise.resolve([
            { id: 'category-1', code: 'CAT-GGL-1' },
            { id: 'category-2', code: 'CAT-GGL-DOES-NOT-EXIST' },
          ]),
        ),
      })),
      insert: vi.fn(() => {
        const chain: Record<string, unknown> = {};

        chain.values = vi.fn(() => chain);
        chain.onConflictDoNothing = vi.fn(() => chain);
        chain.returning = vi.fn(() => Promise.resolve([{ id: 'row-id' }]));

        return chain;
      }),
    };

    const result = await migrateAttributeControls(db as never);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected an ok result');
    expect(result.migrationRecord).toEqual({
      createdAt: 1786935292882,
      inserted: true,
    });
    expect(result.seed.ok).toBe(true);
  });

  it('propagates a fail-closed seed refusal as the top-level result, without inserting anything', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([]),
      select: vi.fn(() => ({
        from: vi.fn(() => Promise.resolve([])),
      })),
      insert: vi.fn(),
    };

    const result = await migrateAttributeControls(db as never);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a refusal');
    expect(result.reason).toBe('missing-category-codes');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('does not attempt the seed if the DDL step fails', async () => {
    const db = {
      execute: vi.fn().mockRejectedValue(new Error('ddl failed')),
      select: vi.fn(),
      insert: vi.fn(),
    };

    await expect(migrateAttributeControls(db as never)).rejects.toThrow(
      'ddl failed',
    );
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('does not attempt the seed if marking the migration applied fails', async () => {
    let ddlCallsRemaining = DDL_STATEMENTS.length;
    const db = {
      execute: vi.fn(() => {
        if (ddlCallsRemaining > 0) {
          ddlCallsRemaining -= 1;

          return Promise.resolve(undefined);
        }

        return Promise.reject(new Error('mark-applied failed'));
      }),
      select: vi.fn(),
      insert: vi.fn(),
    };

    await expect(migrateAttributeControls(db as never)).rejects.toThrow(
      'mark-applied failed',
    );
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
