import type { Database } from '@/lib/db/client';
import { sals3Categories } from '@/lib/db/schema';
import taxonomyV1 from '@/lib/db/seed-data/sals3-taxonomy-v1.json';

type CategoryRow = {
  code: string;
  l1: string | null;
  l2: string | null;
  l3: string | null;
  l4: string | null;
  l5: string | null;
  path: string;
};

const categories = taxonomyV1 as CategoryRow[];

export type SeedSals3CategoriesV1Result = {
  totalInExtract: number;
  inserted: number;
};

/**
 * Inserts the Sals3 Taxonomy v1 extraction (`scripts/seed-sals3-taxonomy-v1.mts`'s
 * own `sals3-taxonomy-v1.json`, 5,595 rows) into `sals3_categories`.
 *
 * `onConflictDoNothing` on the unique `code` — additive and idempotent, safe
 * to run more than once or against a table that already has some rows.
 * Deliberately narrower than the CLI script: this inserts categories only,
 * never deletes anything, and does not touch `sals3_category_presets`. That
 * script's v0-to-v1 replacement (delete stale rows referenced nowhere,
 * insert v1, replace presets) is a real migration for an environment that
 * already has v0 data live under it; this function exists for the opposite,
 * simpler case this session found in production - a table with no v1 rows
 * at all (and nothing else to protect against deleting), reachable only
 * through `/api/internal/catalog/taxonomy/seed-v1` with no direct database
 * access. If presets are ever needed there too, seed them the same way,
 * separately, once actually needed - not speculatively here.
 */
export async function seedSals3CategoriesV1(
  db: Database,
): Promise<SeedSals3CategoriesV1Result> {
  const inserted = await db
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

  return {
    totalInExtract: categories.length,
    inserted: inserted.length,
  };
}
