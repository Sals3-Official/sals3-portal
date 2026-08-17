/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * Seeds `category_attribute_dictionary` and `category_attribute_controls`
 * from `src/lib/db/seed-data/sals3-category-attribute-controls-v1.json`
 * (produced by `scripts/extract-category-attribute-controls.mts`).
 *
 * ## Purely additive - no predecessor extraction to retire
 *
 * Unlike the v0-to-v1 taxonomy replacement (`seed-sals3-taxonomy-v1.mts`),
 * there is no prior attribute-controls extraction this one supersedes. A
 * re-run under a *new* `controlsVersion` string lands new rows beside the
 * old ones; old rows for a superseded version are never deleted here. This
 * script still counts-before-delete and refuses if ever asked to remove a
 * `controlsVersion` still referenced by `product_category_attribute_values`
 * (the seller-owned answer table) - same posture as the existing seed
 * script's FK-holder-count guard, even though the common path never deletes
 * anything.
 *
 * ## Usage
 *
 *   npm run seed:attribute-controls -- --dry-run
 *   npm run seed:attribute-controls
 *
 * A dry run reports what it would insert and writes nothing - the work
 * happens inside a transaction that is always rolled back, so the counts
 * are the database's own answer.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { count, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
/* eslint-disable import/extensions -- extensionless is what actually works
   here, matching this codebase's own scripts/ convention. */
import type { Database } from '../src/lib/db/client';
import { sals3Categories } from '../src/lib/db/schema/pricing-policy';
import {
  categoryAttributeControls,
  categoryAttributeDictionary,
} from '../src/lib/db/schema/category-attribute-controls';
import { productCategoryAttributeValues } from '../src/lib/db/schema/product-catalog';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

const dryRun = process.argv.includes('--dry-run');

const moduleDir = dirname(fileURLToPath(import.meta.url));
const seedDir = join(moduleDir, '..', 'src', 'lib', 'db', 'seed-data');

type DictionaryEntry = {
  attributeName: string;
  canonicalAttributeKey: string;
  defaultInputControlType: string;
  defaultAllowedValues: string[];
  defaultAllowCustomValue: boolean;
  defaultAllowMultipleValues: boolean;
  dataType: string;
  notes: string | null;
};

type ControlEntry = {
  categoryCode: string;
  attributeName: string;
  requirementLevel: string;
  inputControlType: string;
  allowedValues: string[];
  allowCustomValue: boolean;
  allowMultipleValues: boolean;
  sellerHelpText: string | null;
  seoVisibility: string;
  aeoGeoVisibility: string;
  complianceReviewFlag: string;
  sourceBasis: string | null;
};

type ExtractionOutput = {
  source: {
    workbook: string;
    sheet: string;
    sha256: string;
    controlsVersion: string;
  };
  controlsVersion: string;
  dictionary: DictionaryEntry[];
  controls: ControlEntry[];
};

/** Explicit UTF-8: a bare read picks up the platform default and mangles non-ASCII text. */
function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(seedDir, name), 'utf8')) as T;
}

class DryRunRollback extends Error {
  constructor(
    readonly insertedDictionary: number,
    readonly insertedControls: number,
  ) {
    super('dry run');
    this.name = 'DryRunRollback';
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set.');
  }

  const data = readJson<ExtractionOutput>(
    'sals3-category-attribute-controls-v1.json',
  );

  console.log(
    dryRun
      ? 'Mode: DRY RUN - nothing will be written.'
      : 'Mode: APPLY - reference tables will be seeded.',
  );
  console.log(
    `Controls version: ${data.controlsVersion} (${data.dictionary.length} dictionary entries, ${data.controls.length} control rows).`,
  );

  const sql = postgres(connectionString, { max: 1 });
  const db: Database = drizzle(sql);

  try {
    const result = await db
      .transaction(async (tx) => {
        // Refuse to delete a controlsVersion that seller answers still
        // reference - mirrors seed-sals3-taxonomy-v1.mts's count-before-delete
        // guard. Nothing in the common path deletes, but a future re-run
        // that ever adds a delete branch must check this first.
        const [existingControlsForVersion, referencedByValues] =
          await Promise.all([
            tx
              .select({ n: count() })
              .from(categoryAttributeControls)
              .where(
                eq(
                  categoryAttributeControls.controlsVersion,
                  data.controlsVersion,
                ),
              ),
            tx
              .select({ n: count() })
              .from(productCategoryAttributeValues)
              .where(
                eq(
                  productCategoryAttributeValues.controlsVersion,
                  data.controlsVersion,
                ),
              ),
          ]);

        if (
          existingControlsForVersion[0]?.n &&
          existingControlsForVersion[0].n > 0
        ) {
          throw new Error(
            `Controls version "${data.controlsVersion}" already has ${existingControlsForVersion[0].n} row(s) seeded. ` +
              'This script has no update/replace path - re-extract under a new controlsVersion to land a correction beside the old one.',
          );
        }

        console.log(
          `\n${referencedByValues[0]?.n ?? 0} seller answer(s) already reference this controlsVersion string (informational only - never blocks an additive insert).`,
        );

        const categories = await tx
          .select({ id: sals3Categories.id, code: sals3Categories.code })
          .from(sals3Categories);
        const categoryIdByCode = new Map(
          categories.map((row) => [row.code, row.id]),
        );

        const missingCategories = new Set(
          data.controls
            .map((row) => row.categoryCode)
            .filter((code) => !categoryIdByCode.has(code)),
        );

        if (missingCategories.size > 0) {
          throw new Error(
            `${missingCategories.size} category code(s) in the extraction are not present in sals3_categories: ${[...missingCategories].slice(0, 10).join(', ')}${missingCategories.size > 10 ? ', ...' : ''}`,
          );
        }

        const dictionaryValues = data.dictionary.map((entry) => ({
          controlsVersion: data.controlsVersion,
          attributeName: entry.attributeName,
          canonicalAttributeKey: entry.canonicalAttributeKey,
          defaultInputControlType:
            entry.defaultInputControlType as (typeof categoryAttributeDictionary.$inferInsert)['defaultInputControlType'],
          defaultAllowedValues: entry.defaultAllowedValues,
          defaultAllowCustomValue: entry.defaultAllowCustomValue,
          defaultAllowMultipleValues: entry.defaultAllowMultipleValues,
          dataType:
            entry.dataType as (typeof categoryAttributeDictionary.$inferInsert)['dataType'],
          notes: entry.notes,
          sourceWorkbook: data.source.workbook,
          sourceSheet: 'Attribute_Control_Dictionary',
          sourceChecksum: data.source.sha256,
        }));

        const insertedDictionary = await tx
          .insert(categoryAttributeDictionary)
          .values(dictionaryValues)
          .returning({ id: categoryAttributeDictionary.id });

        // Chunked: a 53,625-row insert exceeds the driver's parameter ceiling.
        const CHUNK = 500;
        let insertedControls = 0;

        const controlValues = data.controls.map((row) => ({
          categoryId: categoryIdByCode.get(row.categoryCode)!,
          controlsVersion: data.controlsVersion,
          attributeName: row.attributeName,
          requirementLevel:
            row.requirementLevel as (typeof categoryAttributeControls.$inferInsert)['requirementLevel'],
          inputControlType:
            row.inputControlType as (typeof categoryAttributeControls.$inferInsert)['inputControlType'],
          allowedValues: row.allowedValues,
          allowCustomValue: row.allowCustomValue,
          allowMultipleValues: row.allowMultipleValues,
          sellerHelpText: row.sellerHelpText,
          seoVisibility:
            row.seoVisibility as (typeof categoryAttributeControls.$inferInsert)['seoVisibility'],
          aeoGeoVisibility:
            row.aeoGeoVisibility as (typeof categoryAttributeControls.$inferInsert)['aeoGeoVisibility'],
          complianceReviewFlag:
            row.complianceReviewFlag as (typeof categoryAttributeControls.$inferInsert)['complianceReviewFlag'],
          sourceBasis: row.sourceBasis,
          sourceWorkbook: data.source.workbook,
          sourceSheet: 'Category_Attribute_Controls',
          sourceChecksum: data.source.sha256,
        }));

        // A counting `for`, not `for-of`: `no-restricted-syntax` bans the
        // latter here and has nothing to say about this one.
        for (let index = 0; index < controlValues.length; index += CHUNK) {
          // eslint-disable-next-line no-await-in-loop
          const written = await tx
            .insert(categoryAttributeControls)
            .values(controlValues.slice(index, index + CHUNK))
            .returning({ id: categoryAttributeControls.id });

          insertedControls += written.length;
        }

        const outcome = {
          insertedDictionary: insertedDictionary.length,
          insertedControls,
        };

        if (dryRun) {
          throw new DryRunRollback(
            outcome.insertedDictionary,
            outcome.insertedControls,
          );
        }

        return outcome;
      })
      .catch((error: unknown) => {
        if (error instanceof DryRunRollback) {
          return {
            insertedDictionary: error.insertedDictionary,
            insertedControls: error.insertedControls,
          };
        }

        throw error;
      });

    console.log(
      `\n${dryRun ? 'Would insert' : 'Inserted'} ${result.insertedDictionary} dictionary entr(ies) and ${result.insertedControls} control row(s).`,
    );

    if (dryRun) console.log('Dry run - nothing was written.');
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    '[seed-category-attribute-controls]',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
