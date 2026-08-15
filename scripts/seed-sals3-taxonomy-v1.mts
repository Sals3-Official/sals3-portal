/* eslint-disable no-console -- this is a CLI script; status output is its job. */
/**
 * Replaces Sals3 Taxonomy v0 with v1 in `sals3_categories` and
 * `sals3_category_presets`.
 *
 * ## Why a replacement and not the additive seed
 *
 * `seed-sals3-taxonomy.mts` is `onConflictDoNothing` and says so: it adds codes
 * and never updates or removes one. That is correct for extending a taxonomy and
 * wrong for this, because v1 is not an extension. Not one of v0's 1,345 codes
 * appears in v1's 5,595 — the code scheme itself changed (`CAT-DIG-…` to
 * `CAT-GGL-…`) and the top level went from 29 departments to 21. Running the
 * additive seed would leave both structures in one table with no way to tell
 * which is authoritative.
 *
 * ## What v1 actually is
 *
 * The 21 L1 departments are verbatim Google Product Taxonomy top levels and the
 * codes carry a `GGL` marker. That is worth knowing beyond tidiness: a category
 * from this tree can be emitted as `google_product_category` in a Merchant feed
 * and in JSON-LD without a second crosswalk.
 *
 * ## Deleting, and refusing to delete
 *
 * Owner decision: v0 rows are deleted rather than marked retired — `taxonomy_status`
 * has no `RETIRED` value, so marking them is not available without a migration.
 *
 * Deleting is only safe while nothing points at those rows. `products.category_id`,
 * `provider_category_mappings.sals3_category_id` and `sals3_category_presets.category_id`
 * all reference `sals3_categories` with `ON DELETE restrict`, so a referenced row
 * would abort the transaction mid-run. This counts those references first and
 * refuses with the numbers rather than letting Postgres raise a foreign-key error
 * halfway through — same outcome, but it says which table is holding on.
 *
 * **Zero supplier calls.** Everything read here is a local file and this database.
 *
 * ## Usage
 *
 *   npm run seed:taxonomy-v1 -- --dry-run
 *   npm run seed:taxonomy-v1
 *
 * A dry run reports what it would delete and insert and writes nothing — the work
 * happens inside a transaction that is always rolled back, so the counts are the
 * database's own answer.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { count, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
/* eslint-disable import/extensions -- extensionless is what actually works
   here, matching this codebase's own scripts/ convention. */
import type { Database } from '../src/lib/db/client';
import { products } from '../src/lib/db/schema/product-catalog';
import { sals3Categories } from '../src/lib/db/schema/pricing-policy';
import {
  providerCategoryMappings,
  sals3CategoryPresets,
} from '../src/lib/db/schema/category-mapping';

try {
  process.loadEnvFile('.env.local');
} catch {
  // No .env.local - env vars must already be exported in the shell.
}

const TAXONOMY_VERSION = 'sals3-taxonomy-v1';
const dryRun = process.argv.includes('--dry-run');

const moduleDir = dirname(fileURLToPath(import.meta.url));
const seedDir = join(moduleDir, '..', 'src', 'lib', 'db', 'seed-data');

type CategoryRow = {
  code: string;
  l1: string | null;
  l2: string | null;
  l3: string | null;
  l4: string | null;
  l5: string | null;
  path: string;
};

type PresetPattern = {
  key: string;
  variationArchitecture: string | null;
  tier1Attribute: string | null;
  tier2Attribute: string | null;
  skuFormatStandard: string | null;
  requiredItemAttributesRaw: string | null;
  requiredItemAttributes: string[];
};

type PresetAssignment = {
  code: string;
  presetKey: string;
  storeCatalogueStatus: string | null;
  productExamples: string | null;
};

/** Explicit UTF-8: a bare read picks up the platform default and mangles `₱`. */
function readJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(seedDir, name), 'utf8')) as T;
}

class DryRunRollback extends Error {
  constructor(
    readonly deleted: number,
    readonly insertedCategories: number,
    readonly insertedPresets: number,
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

  const categories = readJson<CategoryRow[]>('sals3-taxonomy-v1.json');
  const presets = readJson<{
    source: { workbook: string; sheet: string; sha256: string };
    patterns: PresetPattern[];
    categories: PresetAssignment[];
  }>('sals3-taxonomy-presets-v1.json');
  const patternByKey = new Map(presets.patterns.map((p) => [p.key, p]));
  const assignmentByCode = new Map(presets.categories.map((a) => [a.code, a]));

  console.log(
    dryRun
      ? 'Mode: DRY RUN - nothing will be written.'
      : 'Mode: APPLY - v0 will be deleted and v1 inserted.',
  );
  console.log(
    `${categories.length} categories and ${presets.patterns.length} variation patterns in the v1 extract.`,
  );

  const sql = postgres(connectionString, { max: 1 });
  const db: Database = drizzle(sql);

  try {
    const result = await db
      .transaction(async (tx) => {
        const incoming = new Set(categories.map((row) => row.code));
        const existing = await tx
          .select({ id: sals3Categories.id, code: sals3Categories.code })
          .from(sals3Categories);
        const stale = existing.filter((row) => !incoming.has(row.code));

        console.log(
          `\n${existing.length} categories already stored; ${stale.length} of them are not in v1.`,
        );

        if (stale.length > 0) {
          const staleIds = stale.map((row) => row.id);
          // Counted before deleting so the refusal can name the holder, rather
          // than surfacing as a foreign-key error partway through the run.
          const [productRows, mappingRows, presetRows] = await Promise.all([
            tx
              .select({ n: count() })
              .from(products)
              .where(inArray(products.categoryId, staleIds)),
            tx
              .select({ n: count() })
              .from(providerCategoryMappings)
              .where(
                inArray(providerCategoryMappings.sals3CategoryId, staleIds),
              ),
            tx
              .select({ n: count() })
              .from(sals3CategoryPresets)
              .where(inArray(sals3CategoryPresets.categoryId, staleIds)),
          ]);
          const held = {
            products: productRows[0]?.n ?? 0,
            mappings: mappingRows[0]?.n ?? 0,
            presets: presetRows[0]?.n ?? 0,
          };

          console.log(
            `  referenced by: ${held.products} product(s), ${held.mappings} mapping(s), ${held.presets} preset row(s)`,
          );

          if (held.products > 0 || held.mappings > 0) {
            throw new Error(
              `Refusing to delete: ${held.products} product(s) and ${held.mappings} category mapping(s) still point at v0 categories. ` +
                'Re-point or remove those first — deleting underneath them would fail on the foreign key anyway.',
            );
          }

          // Preset rows are this script's own output and are replaced wholesale.
          if (held.presets > 0) {
            await tx
              .delete(sals3CategoryPresets)
              .where(inArray(sals3CategoryPresets.categoryId, staleIds));
          }

          await tx
            .delete(sals3Categories)
            .where(inArray(sals3Categories.id, staleIds));
        }

        const insertedCategories = await tx
          .insert(sals3Categories)
          .values(
            categories.map((row) => ({
              code: row.code,
              l1: row.l1,
              l2: row.l2,
              l3: row.l3,
              l4: row.l4,
              l5: row.l5,
              path: row.path,
            })),
          )
          .onConflictDoNothing({ target: sals3Categories.code })
          .returning({ id: sals3Categories.id });

        // Re-read rather than trusting the insert's return: a re-run inserts
        // nothing and still has to attach presets to the rows already there.
        const stored = await tx
          .select({ id: sals3Categories.id, code: sals3Categories.code })
          .from(sals3Categories);
        const idByCode = new Map(stored.map((row) => [row.code, row.id]));

        await tx
          .delete(sals3CategoryPresets)
          .where(eq(sals3CategoryPresets.taxonomyVersion, TAXONOMY_VERSION));

        const presetValues = categories.flatMap((row) => {
          const assignment = assignmentByCode.get(row.code);
          const pattern =
            assignment === undefined
              ? undefined
              : patternByKey.get(assignment.presetKey);
          const categoryId = idByCode.get(row.code);

          if (pattern === undefined || categoryId === undefined) return [];

          return [
            {
              categoryId,
              taxonomyVersion: TAXONOMY_VERSION,
              variationArchitecture: pattern.variationArchitecture,
              tier1Attribute: pattern.tier1Attribute,
              tier2Attribute: pattern.tier2Attribute,
              skuFormatStandard: pattern.skuFormatStandard,
              requiredItemAttributes: pattern.requiredItemAttributes,
              requiredItemAttributesRaw: pattern.requiredItemAttributesRaw,
              storeCatalogueStatus: assignment?.storeCatalogueStatus ?? null,
              productExamples: assignment?.productExamples ?? null,
              // Provenance, required by the table and carried from the extract
              // rather than retyped: the checksum is of the workbook itself, so a
              // re-extraction from a different file is visible in the rows.
              sourceWorkbook: presets.source.workbook,
              sourceSheet: presets.source.sheet,
              sourceChecksum: presets.source.sha256,
            },
          ];
        });

        // Chunked: one 5,595-row insert exceeds the driver's parameter ceiling.
        const CHUNK = 500;
        let insertedPresets = 0;

        // A counting `for`, not `for-of`: `no-restricted-syntax` bans the
        // latter here and has nothing to say about this one.
        for (let index = 0; index < presetValues.length; index += CHUNK) {
          // eslint-disable-next-line no-await-in-loop
          const written = await tx
            .insert(sals3CategoryPresets)
            .values(presetValues.slice(index, index + CHUNK))
            .returning({ id: sals3CategoryPresets.id });

          insertedPresets += written.length;
        }

        const outcome = {
          deleted: stale.length,
          insertedCategories: insertedCategories.length,
          insertedPresets,
        };

        if (dryRun) {
          throw new DryRunRollback(
            outcome.deleted,
            outcome.insertedCategories,
            outcome.insertedPresets,
          );
        }

        return outcome;
      })
      .catch((error: unknown) => {
        if (error instanceof DryRunRollback) {
          return {
            deleted: error.deleted,
            insertedCategories: error.insertedCategories,
            insertedPresets: error.insertedPresets,
          };
        }

        throw error;
      });

    console.log(
      `\n${dryRun ? 'Would delete' : 'Deleted'} ${result.deleted} v0 categor(ies).`,
    );
    console.log(
      `${dryRun ? 'Would insert' : 'Inserted'} ${result.insertedCategories} categor(ies) and ${result.insertedPresets} preset row(s).`,
    );

    if (dryRun) console.log('Dry run - nothing was written.');
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    '[seed-sals3-taxonomy-v1]',
    error instanceof Error ? error.message : error,
  );
  process.exitCode = 1;
});
