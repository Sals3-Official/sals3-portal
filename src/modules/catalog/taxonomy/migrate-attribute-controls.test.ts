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
  runAttributeControlsDdl,
  seedAttributeControlsData,
} from './migrate-attribute-controls';
/* eslint-enable import/first */

describe('runAttributeControlsDdl', () => {
  it('runs every statement and reports none skipped on a fresh database', async () => {
    const db = { execute: vi.fn().mockResolvedValue(undefined) };

    const result = await runAttributeControlsDdl(db as never);

    expect(result.statementsSkippedAlreadyExists).toBe(0);
    expect(result.statementsRun).toBeGreaterThan(0);
    expect(db.execute).toHaveBeenCalled();
  });

  it('tolerates "already exists" on every statement, for a second call over an already-migrated environment', async () => {
    const alreadyExists = Object.assign(new Error('already exists'), {
      code: '42710',
    });
    const db = { execute: vi.fn().mockRejectedValue(alreadyExists) };

    const result = await runAttributeControlsDdl(db as never);

    expect(result.statementsRun).toBe(0);
    expect(result.statementsSkippedAlreadyExists).toBeGreaterThan(0);
  });

  it('does not swallow an unrelated error', async () => {
    const db = {
      execute: vi.fn().mockRejectedValue(new Error('connection refused')),
    };

    await expect(runAttributeControlsDdl(db as never)).rejects.toThrow(
      'connection refused',
    );
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

  it('reports the category code the extract references but the database does not have, and skips its control row', async () => {
    const { db } = fakeDb({
      categoryRows: [{ id: 'category-1', code: 'CAT-GGL-1' }],
    });

    const result = await seedAttributeControlsData(db as never);

    expect(result.missingCategoryCodes).toEqual(['CAT-GGL-DOES-NOT-EXIST']);
    expect(result.controlsInExtract).toBe(2);
    expect(result.controlsInserted).toBe(1);
  });

  it('inserts the dictionary and controls with onConflictDoNothing on each table’s natural unique key', async () => {
    const { db, inserts } = fakeDb({
      categoryRows: [{ id: 'category-1', code: 'CAT-GGL-1' }],
    });

    await seedAttributeControlsData(db as never);

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
      categoryRows: [{ id: 'category-1', code: 'CAT-GGL-1' }],
    });

    const result = await seedAttributeControlsData(db as never);

    expect(result.dictionaryInExtract).toBe(1);
    expect(result.controlsVersion).toBe('sals3-attribute-controls-v1');
  });
});
