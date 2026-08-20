/**
 * Whether a category code is a real Sals3 category, as a pure string test.
 *
 * Lives here rather than in `modules/catalog/taxonomy/v1-reference.ts` — which
 * re-exports it — because that module imports Drizzle and the schema for its
 * queries, and the product editor is a client component. The predicate itself
 * needs neither, and the editor has to apply exactly the rule publication
 * applies or it will keep telling sellers a listing can publish when it cannot.
 */

/**
 * The v1 seed's own code convention (`scripts/seed-sals3-taxonomy-v1.mts`,
 * `src/lib/db/seed-data/sals3-taxonomy-v1.json` — every one of its 5,595 rows
 * is `CAT-GGL-<google product category id>`).
 */
export const TAXONOMY_V1_CODE_PREFIX = 'CAT-GGL-';

/**
 * A `CJ-<uuid>` mirror that `cj-mirror.ts` auto-creates from a supplier
 * category is not a Sals3 category.
 *
 * A mirror is a perfectly good DRAFT default — a new product has to sit
 * somewhere before a person has looked at it, and the supplier's own category is
 * the best guess available. By owner decision (2026-08-20) publication requires
 * a real one.
 */
export function isSals3TaxonomyCode(code: string | null): boolean {
  return code !== null && code.startsWith(TAXONOMY_V1_CODE_PREFIX);
}
