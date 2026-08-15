import { asc, like, not, sql } from 'drizzle-orm';
import { sals3Categories } from '@/lib/db/schema';
import type { Executor } from '@/modules/catalog/candidates/repository';

/**
 * Read-only Sals3 Taxonomy v1 reference data — deliberately its own file,
 * separate from `repository.ts`, so a seller-facing surface can import this
 * one query without also gaining access to the mutation-adjacent functions
 * that file holds (`insertMappingProposal`, `reviewMapping`,
 * `supersedeActiveMapping`). `boundaries.test.ts` enforces that separation:
 * `taxonomy/repository.ts` stays restricted to the one authorized
 * category-mapping action, and this file is the only taxonomy import the
 * product editor page may reach for directly.
 */

/**
 * The v1 seed's own code convention (`scripts/seed-sals3-taxonomy-v1.mts`,
 * `src/lib/db/seed-data/sals3-taxonomy-v1.json` — every one of its 5,595
 * rows is `CAT-GGL-<google product category id>`).
 */
const TAXONOMY_V1_CODE_PREFIX = 'CAT-GGL-';

/**
 * Every Sals3 Taxonomy v1 category, as `{ code, path }` pairs, for a
 * search-first category picker.
 *
 * `sals3_categories` is not exclusively v1 rows: `cj-mirror.ts`'s
 * `ensureMirrorCategoryRow` also inserts into this same table, one row per
 * CJ supplier category with no reviewed mapping, verbatim as CJ's own
 * observed category name (`code = CJ-<externalCategoryId>`). Selecting the
 * whole table without this filter let a seller search up CJ's own taxonomy
 * language (e.g. a CJ-specific term like "Fedoras") through what was meant
 * to be a search over the curated, frozen v1 extraction only — defeating
 * the entire point of this picker, which exists specifically to move away
 * from CJ's category text.
 *
 * A deliberate exception to the general "no unbounded scan" rule: v1 is a
 * fixed, frozen extraction (5,595 rows, `ACTIVE_TAXONOMY_VERSION`) that does
 * not grow with user data the way `products` or `provider_category_mappings`
 * do, and only the two smallest columns are read — a few hundred KB once per
 * editor page load, not once per keystroke.
 */
export async function listSals3CategoryV1Options(
  executor: Executor,
): Promise<{ code: string; path: string }[]> {
  return executor
    .select({ code: sals3Categories.code, path: sals3Categories.path })
    .from(sals3Categories)
    .where(like(sals3Categories.code, `${TAXONOMY_V1_CODE_PREFIX}%`))
    .orderBy(asc(sals3Categories.path));
}

export type Sals3CategoriesStatus = {
  total: number;
  /** `code LIKE 'CAT-GGL-%'` - the real, frozen v1 extraction. */
  v1Count: number;
  /** `code LIKE 'CJ-%'` - `cj-mirror.ts`'s auto-created rows. */
  mirrorCount: number;
  /**
   * Neither prefix - most plausibly leftover Taxonomy v0 rows
   * (`CAT-DIG-...`) that a v0-to-v1 migration never ran against this
   * database. A non-zero count here is itself the finding: it means
   * `listSals3CategoryV1Options` was never actually empty by accident, or
   * that a real migration step is still owed to this environment.
   */
  otherCount: number;
  /** Up to 10 codes from `otherCount`, to name what's actually there. */
  otherSampleCodes: string[];
};

/**
 * A read-only census of `sals3_categories`, for diagnosing environments
 * this session has no direct database access to (see
 * `/api/internal/catalog/taxonomy/status`). Answers "is the v1 extraction
 * actually seeded here" without guessing from picker behaviour alone - an
 * empty search result and a genuinely empty table look identical from the
 * picker, but a table full of stale v0 rows looks the same too.
 */
export async function getSals3CategoriesStatus(
  executor: Executor,
): Promise<Sals3CategoriesStatus> {
  const v1Pattern = `${TAXONOMY_V1_CODE_PREFIX}%`;
  const mirrorPattern = 'CJ-%';

  const [counts] = await executor
    .select({
      total: sql<number>`count(*)`,
      v1Count: sql<number>`count(*) filter (where ${sals3Categories.code} like ${v1Pattern})`,
      mirrorCount: sql<number>`count(*) filter (where ${sals3Categories.code} like ${mirrorPattern})`,
    })
    .from(sals3Categories);

  const others = await executor
    .select({ code: sals3Categories.code })
    .from(sals3Categories)
    .where(not(like(sals3Categories.code, v1Pattern)))
    .limit(10);
  const otherRows = others.filter((row) => !row.code.startsWith('CJ-'));

  return {
    total: Number(counts?.total ?? 0),
    v1Count: Number(counts?.v1Count ?? 0),
    mirrorCount: Number(counts?.mirrorCount ?? 0),
    otherCount:
      Number(counts?.total ?? 0) -
      Number(counts?.v1Count ?? 0) -
      Number(counts?.mirrorCount ?? 0),
    otherSampleCodes: otherRows.map((row) => row.code),
  };
}
