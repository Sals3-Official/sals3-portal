/**
 * Sals3 Taxonomy v1's 21 main categories — its L1 departments, verbatim.
 *
 * ## Why a whitelist and not "every distinct `l1`"
 *
 * `sals3_categories` is not only the Sals3 taxonomy. Auto-mirrored CJ
 * categories live in the same table and are minted with the same `CAT-GGL-`
 * code prefix, and their rows put a whole supplier path in `l1`
 * ("Men's Clothing > Outerwear & Jackets > Men's Jackets", sometimes
 * slash-separated). Selecting distinct `l1` therefore returns 32 values in
 * production, 11 of which are supplier filing paths rather than departments,
 * and no code-prefix or string-shape filter separates them reliably.
 *
 * ## Why this is allowed to be a constant
 *
 * A taxonomy replacement is a deliberate, scripted event — see
 * `scripts/seed-sals3-taxonomy-v1.mts`, which replaced v0's 29 departments
 * with these 21 verbatim Google Product Taxonomy top levels. This list moves
 * in the same commit as that script, never on its own, and the read stays
 * data-driven: a department that is not in the table does not appear in the
 * storefront's list, whitelisted or not.
 */
import { slugBaseFromTitle } from '@/modules/catalog/products/slug';

const SALS3_TAXONOMY_DEPARTMENTS = [
  'Animals & Pet Supplies',
  'Apparel & Accessories',
  'Arts & Entertainment',
  'Baby & Toddler',
  'Business & Industrial',
  'Cameras & Optics',
  'Electronics',
  'Food, Beverages & Tobacco',
  'Furniture',
  'Hardware',
  'Health & Beauty',
  'Home & Garden',
  'Luggage & Bags',
  'Mature',
  'Media',
  'Office Supplies',
  'Religious & Ceremonial',
  'Software',
  'Sporting Goods',
  'Toys & Games',
  'Vehicles & Parts',
] as const;

/**
 * `animals-pet-supplies` → `Animals & Pet Supplies`.
 *
 * ## Why a map and not a query
 *
 * `toCategorySlug` is one-way — it lowercases, replaces every non-alphanumeric
 * run with a hyphen, and truncates. There is no SQL expression that inverts it,
 * so a department slug arriving in a URL cannot be turned into a `WHERE` value
 * by the database. Building the 21 slugs from the same list the forward
 * direction uses keeps both directions derived from one source: a taxonomy
 * reseed that renames a department changes the slug on both sides in the same
 * commit, or neither.
 *
 * ## Why this doubles as the allow-list
 *
 * The returned name is interpolated into a `sals3_categories.l1` comparison, so
 * an unrecognised slug must never reach the query. Returning `null` for
 * anything not in this list satisfies code rule 33 (allow-lists, never
 * block-lists) at the one boundary where a buyer-controlled path segment
 * becomes a query value — and it is why the caller answers 404 rather than
 * running a query that would return nothing anyway.
 *
 * Built once at module load: 21 entries, and the list is a frozen constant.
 */
const DEPARTMENT_SLUG_BY_NAME = new Map<string, string>(
  SALS3_TAXONOMY_DEPARTMENTS.map((name) => [name, slugBaseFromTitle(name)]),
);

const DEPARTMENT_NAME_BY_SLUG = new Map<string, string>(
  SALS3_TAXONOMY_DEPARTMENTS.map((name) => [slugBaseFromTitle(name), name]),
);

export function departmentNameForSlug(slug: string): string | null {
  return DEPARTMENT_NAME_BY_SLUG.get(slug) ?? null;
}

/**
 * The other direction: `Apparel & Accessories` → `apparel-accessories`.
 *
 * Derived from the same 21-name list, so a taxonomy reseed moves both directions
 * in one commit or neither — the property the note above exists to protect.
 *
 * Used by `category-trail.ts` to keep an L1 breadcrumb entry on the bare
 * department URL that is already live and already linked from four surfaces,
 * rather than minting a second address for it.
 */
export function departmentSlugForName(name: string): string | null {
  return DEPARTMENT_SLUG_BY_NAME.get(name.trim()) ?? null;
}

export default SALS3_TAXONOMY_DEPARTMENTS;
