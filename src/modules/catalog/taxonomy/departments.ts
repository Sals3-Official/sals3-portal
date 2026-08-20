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

export default SALS3_TAXONOMY_DEPARTMENTS;
