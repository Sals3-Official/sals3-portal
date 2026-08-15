import { asc, like } from 'drizzle-orm';
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
// matches this module's sibling `taxonomy/repository.ts` convention.
// eslint-disable-next-line import/prefer-default-export -- named on purpose
export async function listSals3CategoryV1Options(
  executor: Executor,
): Promise<{ code: string; path: string }[]> {
  return executor
    .select({ code: sals3Categories.code, path: sals3Categories.path })
    .from(sals3Categories)
    .where(like(sals3Categories.code, `${TAXONOMY_V1_CODE_PREFIX}%`))
    .orderBy(asc(sals3Categories.path));
}
