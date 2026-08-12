/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * One-time seed: loads Sals3 Taxonomy v0 form presets (ADR-002 §4) into
 * `sals3_category_presets` from the frozen extraction of
 * `sals3-ecommerce/docs/Raw/universal_category_variation_taxonomy.xlsx`'s
 * `Universal_Category_Taxonomy` sheet — the `Variation Architecture`,
 * `Tier 1/2 Attribute`, `SKU Format Standard`, `Required Item Attributes`,
 * `Store Catalogue Status`, and `Product Examples & Guidelines` columns that
 * `scripts/seed-sals3-taxonomy.mts` did not carry.
 *
 * Same provenance rules as that script, for the same reasons:
 *
 * - The workbook is NOT read at runtime and NOT read here. No `.xlsx` parser
 *   is added to this app's dependencies, and nothing in the running
 *   application depends on the sibling `sals3-ecommerce` repository being
 *   present. `src/lib/db/seed-data/sals3-taxonomy-presets-v0.json` is the
 *   frozen extraction, checked in, with its own SHA-256 recorded on every
 *   row it produces.
 * - The extraction is normalised: the 1,345 records use only 15 distinct
 *   preset patterns, so the artifact stores the patterns once and assigns
 *   each category a key. That is a storage detail, not an interpretation —
 *   every value below is the workbook's verbatim cell text.
 *
 * Idempotent: `onConflictDoNothing` on `(category_id, taxonomy_version)`, so
 * re-running inserts only genuinely new rows and never overwrites a preset a
 * past decision was made from. Publishing a corrected extraction is a new
 * `taxonomyVersion`, not an update.
 *
 * NOT RUN as part of this change, and it requires the migration that creates
 * `sals3_category_presets` to be generated and applied first. Run only after
 * that approval, and only after `npm run seed:taxonomy` has populated
 * `sals3_categories`:
 *
 *   npm run seed:taxonomy-presets
 *
 * See `scripts/bootstrap-sals3-official-cj.mts` for why this uses `tsx`,
 * extensionless relative imports, and its own single-connection client
 * instead of `src/lib/db/client.ts`'s pooled `getDb()`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import type { Database } from '../src/lib/db/client';
/* eslint-disable import/extensions -- extensionless is what actually works
   here, matching this codebase's own scripts/ convention. */
import { sals3Categories } from '../src/lib/db/schema/pricing-policy';
import { sals3CategoryPresets } from '../src/lib/db/schema/category-mapping';

/**
 * Same three lines as `bootstrap-sals3-official-cj.mts`, and for the same
 * reason: `tsx` runs this outside Next.js, so nothing else loads `.env.local`.
 */
try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

type PresetPattern = {
  key: string;
  variationArchitecture: string | null;
  tier1Attribute: string | null;
  tier2Attribute: string | null;
  skuFormatStandard: string | null;
  requiredItemAttributesRaw: string | null;
  requiredItemAttributes: string[];
};

type PresetExtract = {
  source: {
    workbook: string;
    sheet: string;
    vaultPath: string;
    taxonomyVersion: string;
    extractedOn: string;
    dataRecords: number;
    distinctPresetPatterns: number;
    checksum: string;
  };
  patterns: PresetPattern[];
  categories: Array<{
    code: string;
    presetKey: string;
    storeCatalogueStatus: string | null;
    productExamples: string | null;
  }>;
};

function loadExtract(): PresetExtract {
  const jsonPath = join(
    moduleDir,
    '../src/lib/db/seed-data/sals3-taxonomy-presets-v0.json',
  );

  return JSON.parse(readFileSync(jsonPath, 'utf-8')) as PresetExtract;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;

  if (connectionString === undefined || connectionString === '') {
    throw new Error('DATABASE_URL is not set.');
  }

  const extract = loadExtract();
  const patterns = new Map(
    extract.patterns.map((pattern) => [pattern.key, pattern]),
  );

  console.log(
    `Loaded ${extract.categories.length} category presets (${extract.patterns.length} distinct patterns) from the frozen extract ${extract.source.checksum.slice(0, 12)}.`,
  );

  const sql = postgres(connectionString, { max: 1 });
  const db: Database = drizzle(sql);

  try {
    const categoryRows = await db
      .select({ id: sals3Categories.id, code: sals3Categories.code })
      .from(sals3Categories);
    const categoryIdByCode = new Map(
      categoryRows.map((row) => [row.code, row.id]),
    );

    const prepared = extract.categories.map((category) => ({
      category,
      categoryId: categoryIdByCode.get(category.code),
      pattern: patterns.get(category.presetKey),
    }));

    const missingCodes = prepared
      .filter(
        (row) => row.categoryId === undefined || row.pattern === undefined,
      )
      .map((row) => row.category.code);

    const values = prepared.flatMap((row) =>
      row.categoryId === undefined || row.pattern === undefined
        ? []
        : [
            {
              categoryId: row.categoryId,
              taxonomyVersion: extract.source.taxonomyVersion,
              variationArchitecture: row.pattern.variationArchitecture,
              tier1Attribute: row.pattern.tier1Attribute,
              tier2Attribute: row.pattern.tier2Attribute,
              skuFormatStandard: row.pattern.skuFormatStandard,
              requiredItemAttributes: row.pattern.requiredItemAttributes,
              requiredItemAttributesRaw: row.pattern.requiredItemAttributesRaw,
              storeCatalogueStatus: row.category.storeCatalogueStatus,
              productExamples: row.category.productExamples,
              sourceWorkbook: extract.source.workbook,
              sourceSheet: extract.source.sheet,
              sourceChecksum: extract.source.checksum,
            },
          ],
    );

    if (missingCodes.length > 0) {
      // Loud, not silent: a preset with no category row means the taxonomy
      // seed has not run, or the two extractions have drifted apart.
      console.warn(
        `Skipped ${missingCodes.length} presets with no matching sals3_categories row. First few: ${missingCodes.slice(0, 5).join(', ')}`,
      );
    }

    const inserted = await db
      .insert(sals3CategoryPresets)
      .values(values)
      .onConflictDoNothing({
        target: [
          sals3CategoryPresets.categoryId,
          sals3CategoryPresets.taxonomyVersion,
        ],
      })
      .returning({ id: sals3CategoryPresets.id });

    console.log(
      `Inserted ${inserted.length} new presets (${values.length - inserted.length} already present, left untouched).`,
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error('[seed-sals3-taxonomy-presets] failed', error);
  process.exitCode = 1;
});
