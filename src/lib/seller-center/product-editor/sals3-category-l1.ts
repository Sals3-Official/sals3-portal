/**
 * The 21 L1 departments of Sals3 Taxonomy v1.
 *
 * These are the Google Product Taxonomy top-level categories, verbatim — the
 * workbook's codes carry a `GGL` marker and the tree is Google's. Keeping the
 * names unchanged is what lets a category from this tree be emitted as
 * `google_product_category` in a Merchant feed and in JSON-LD without a second
 * crosswalk, so they are not reworded to sound more like Sals3.
 *
 * Generated from `src/lib/db/seed-data/sals3-taxonomy-v1.json`, which is the
 * frozen extraction of
 * `sals3-ecommerce/docs/Raw/universal_category_variation_taxonomy.xlsx`. v0's 29
 * departments were a Shopee-derived tree and share no code with this one.
 */
export const SALS3_CATEGORY_L1_OPTIONS = [
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

export type Sals3CategoryL1 = (typeof SALS3_CATEGORY_L1_OPTIONS)[number];
