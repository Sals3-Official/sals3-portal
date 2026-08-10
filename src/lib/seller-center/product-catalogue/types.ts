import type { MoneyValue } from '@/lib/seller-center/product-editor/types';

/**
 * Types for the Product Catalogue design preview ("Product Catalogue" nav
 * item under Dropship Catalogue).
 *
 * Design-only, same posture as `product-editor/types.ts`: nothing here
 * reads a database. Sals3 has no Product/Variant/Offer table yet (see
 * [[cj-candidate-to-sals3-product-draft-implementation-spec]] and `hot.md`'s
 * "no writable Sals3 catalogue exists yet"), and this screen assumes
 * listing-management concepts - units sold, wishlist count, page views,
 * a rating, a content score, an A/B test tag, an admin QC/Violation queue,
 * a soft-delete trash bin - that have no backend anywhere in this repo.
 * Every fixture value is invented for interface review, not a confirmed
 * business rule or a real metric.
 */

/**
 * Listing lifecycle for the catalogue list. Deliberately not the real
 * seven-state evaluation pipeline (`QUEUED`/`EVALUATING`/`PASS`/...) - this
 * models a *published* seller catalogue's own states (what a seller sees
 * after a product exists), which nothing in this repo produces yet.
 */
export const CATALOGUE_STATUSES = [
  'ACTIVE',
  'INACTIVE',
  'DRAFT',
  'PENDING_QC',
  'VIOLATION',
  'DELETED',
] as const;

export type CatalogueStatus = (typeof CATALOGUE_STATUSES)[number];

export type ContentScoreLevel = 'TOP' | 'GOOD' | 'NEEDS_IMPROVEMENT';

export type CatalogueVariantFixture = {
  id: string;
  /** e.g. "Color: Green, Size: Medium 31-35". */
  specsLabel: string;
  sellerSku: string;
  hasImage: boolean;
  price: MoneyValue;
  /** Strikethrough "was" price. `null` when there is no claimed discount. */
  compareAtPrice: MoneyValue | null;
  stock: number;
  active: boolean;
};

export type CatalogueProductFixture = {
  id: string;
  /** CJ-style external product id shown with a copy button - display only. */
  externalProductId: string;
  name: string;
  hasImage: boolean;
  status: CatalogueStatus;
  categoryPath: string;
  createdAt: string;
  /** `null` renders as an em dash, matching this repo's "never fake a zero" rule. */
  abTestTag: string | null;
  /** Fictional engagement figures - see the module-level notice above. */
  unitsSold30d: number;
  wishlistCount30d: number;
  pageViews30d: number;
  ratingAverage: number | null;
  ratingCount: number;
  contentScore: ContentScoreLevel;
  price: MoneyValue;
  compareAtPrice: MoneyValue | null;
  totalStock: number;
  active: boolean;
  /** Links "Edit" to a real fixture already built in the Product Editor. */
  editorFixtureKey: string;
  variants: CatalogueVariantFixture[];
};

export const CONTENT_SCORE_LABELS: Record<ContentScoreLevel, string> = {
  TOP: 'Top',
  GOOD: 'Good',
  NEEDS_IMPROVEMENT: 'Needs improvement',
};

export const CATALOGUE_STATUS_LABELS: Record<CatalogueStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  DRAFT: 'Draft',
  PENDING_QC: 'Pending QC',
  VIOLATION: 'Violation',
  DELETED: 'Deleted',
};

export type CatalogueSortKey =
  | 'CREATED_DESC'
  | 'PRICE_ASC'
  | 'PRICE_DESC'
  | 'STOCK_ASC'
  | 'STOCK_DESC'
  | 'UNITS_SOLD_DESC';

export const CATALOGUE_SORT_LABELS: Record<CatalogueSortKey, string> = {
  CREATED_DESC: 'Newest first',
  PRICE_ASC: 'Price: low to high',
  PRICE_DESC: 'Price: high to low',
  STOCK_ASC: 'Stock: low to high',
  STOCK_DESC: 'Stock: high to low',
  UNITS_SOLD_DESC: 'Sales (30d)',
};

export type CatalogueSearchField = 'NAME' | 'PRODUCT_ID' | 'SELLER_SKU';

export const CATALOGUE_SEARCH_FIELD_LABELS: Record<
  CatalogueSearchField,
  string
> = {
  NAME: 'Product name',
  PRODUCT_ID: 'Product ID',
  SELLER_SKU: 'Seller SKU',
};
