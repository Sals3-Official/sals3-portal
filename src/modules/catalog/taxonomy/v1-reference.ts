import { asc } from 'drizzle-orm';
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
 * Every Sals3 Taxonomy v1 category, as `{ code, path }` pairs, for a
 * search-first category picker.
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
    .orderBy(asc(sals3Categories.path));
}
