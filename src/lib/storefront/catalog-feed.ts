import { z } from 'zod';
import type { DescriptionBlock } from '@/modules/catalog/products/description-document';
import type {
  StorefrontCategoryRow,
  StorefrontDetailRow,
  StorefrontListRow,
  StorefrontPage,
  StorefrontVariant,
} from '@/modules/catalog/storefront/read-model';

/**
 * The `sals3-ecommerce` storefront feed contract — a live cross-repository
 * dependency. This maps Sals3 catalogue rows to it and does nothing else: no
 * database access, no supplier access, no FX. Pure functions, so the contract
 * can be tested without a database.
 *
 * ## The contract is additive-only, and that is not a style preference
 *
 * `sals3-ecommerce/src/services/products.ts` validates every response with a
 * Zod schema that **rejects the entire page** if a key is missing or empty:
 * `ratingLine` and `shipLine` are `min(1)`, `oldPriceMinor` is required,
 * `slug` and `category` must match `^[a-z0-9]+(?:-[a-z0-9]+)*$`, and
 * `priceMinor` must be a positive integer. Dropping a key here breaks the live
 * storefront harder than the 502 this rewrite replaces. So every legacy key
 * stays, every new key is optional, and the portal ships first.
 *
 * ## `ratingLine` and `shipLine` are non-claims, not values
 *
 * We would rather omit them — Sals3 has no buyer reviews and no delivery
 * estimate, and CJ's supplier-platform review counts are not Sals3 ratings
 * (see the wiki's corrected external facts). But the consumer's schema
 * requires a non-empty string, so they carry text that asserts nothing:
 * "No reviews yet" and "Delivery quoted at checkout" (ADR-003 — freight is a
 * destination-specific quote, never a browse-time promise). Both are
 * deprecated: once the storefront makes them optional they leave this file.
 */

export const storefrontSectionSchema = z.enum(['for-you', 'deals']);

export const storefrontFeedQuerySchema = z.object({
  section: storefrontSectionSchema.catch('for-you').default('for-you'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
  limit: z.coerce.number().int().min(1).max(30).catch(14).default(14),
});

export type StorefrontFeedQuery = z.infer<typeof storefrontFeedQuerySchema>;

/**
 * The consumer's own slug/category shape. Mirrored here so a row that cannot
 * satisfy it is dropped by the producer, where the failure is one missing card
 * with a server-side log, instead of by the consumer, where it is a thrown
 * page.
 */
const PUBLIC_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Bounded, because this is applied to a path segment a buyer controls. The
 * consumer caps `id` at 120 characters, and `slug.ts` truncates well below
 * that, so anything longer cannot be one of ours.
 */
const MAX_SLUG_LENGTH = 120;

export function isPublicSlug(value: string): boolean {
  return value.length <= MAX_SLUG_LENGTH && PUBLIC_SLUG_PATTERN.test(value);
}

/** @deprecated Non-claim filler for a required consumer key. */
const NO_REVIEWS_LINE = 'No reviews yet';
/** @deprecated Non-claim filler for a required consumer key. */
const DELIVERY_AT_CHECKOUT_LINE = 'Delivery quoted at checkout';

/**
 * Every published product has a mapped category — `publishProduct` refuses
 * `CATEGORY_UNMAPPED`. This exists because the consumer's key is required and
 * a null would fail its regex, so a category-less row still renders instead of
 * taking the page down. It names the absence rather than guessing a category.
 */
const UNCATEGORISED_CODE = 'uncategorised';

export type StorefrontProduct = {
  id: string;
  slug: string;
  title: string;
  priceMinor: number;
  /**
   * Sals3 publishes no comparison ("was") price, so this deliberately equals
   * `priceMinor`: every `sals3-ecommerce` card renders the strikethrough and
   * the percent-off badge only when the old price is strictly greater, so an
   * equal value shows one honest price and no discount claim.
   *
   * Never derive this from the current price. A was/now pair produced by
   * marking the live price up is not evidence that anything ever sold for the
   * higher number, and ADR-003 prohibits it. The field stays in the contract
   * because the consumer's schema requires it, and so a genuine value can fill
   * it once `product_offers.compare_at_amount_minor` — which its own CHECK
   * constraint refuses to store without `comparison_evidence_id` — is set.
   */
  oldPriceMinor: number;
  imageUrl: string | null;
  imageAlt: string;
  /** @deprecated See the module doc. */
  ratingLine: string;
  /** @deprecated See the module doc. */
  shipLine: string;
  category: string;
  /** Which currency `priceMinor` is denominated in. ADR-003 phase 1: `USD`. */
  currency: string;
  availability: 'AVAILABLE' | 'UNKNOWN' | 'UNAVAILABLE';
  /** Omitted when the product has no mapped Sals3 category. */
  categoryName?: string;
};

/**
 * One product's full detail.
 *
 * Every field beyond `StorefrontProduct` is optional, and the mapper **omits**
 * rather than defaults: an absent `description` means nobody has written one,
 * which is different from an empty one, and the consumer cannot tell those
 * apart once a value is present. That is also what makes the rollout safe —
 * the storefront can ship its richer PDP before every product carries every
 * field.
 */
export type StorefrontProductDetail = StorefrontProduct & {
  publishedAt: string;
  /** Full taxonomy path, for a breadcrumb. Omitted when unmapped. */
  categoryPath?: string;
  /** At least the card's image when one exists; more once evidence is captured. */
  images: { url: string; alt: string }[];
  description?: { blocks: DescriptionBlock[] };
  variants?: StorefrontProductVariant[];
  specs?: StorefrontProductSpecs;
};

export type StorefrontProductVariant = {
  id: string;
  sku: string;
  priceMinor: number;
  currency: string;
  availability: 'AVAILABLE' | 'UNKNOWN' | 'UNAVAILABLE';
  /** Omitted for a product with no option axes — one implicit variant. */
  options?: { name: string; value: string }[];
};

/**
 * Physical and identifier facts. Supplier-reported, not Sals3-verified — the
 * consumer must label them as such rather than presenting them as measured.
 */
export type StorefrontProductSpecs = {
  sku?: string;
  weightGrams?: number;
  lengthMillimeters?: number;
  widthMillimeters?: number;
  heightMillimeters?: number;
  gtins?: string[];
  mpn?: string;
  brand?: string;
  condition?: 'NEW' | 'REFURBISHED' | 'USED';
};

export type StorefrontProductFeed = {
  products: StorefrontProduct[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type StorefrontCategory = {
  id: string;
  code: string;
  name: string;
};

/**
 * The leaf of a taxonomy path (`"Home & Garden > Kitchen > Cookware"` →
 * `"Cookware"`), which is what a buyer-facing category chip should say. The
 * full path is available on the detail response for a breadcrumb.
 */
export function categoryLeafName(path: string): string {
  const segments = path
    .split('>')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');

  return segments[segments.length - 1] ?? path;
}

/**
 * A ≤4-character display code, because that is what the consumer's category
 * chip renders. The real taxonomy code is 14 characters (`CAT-DIG-100801`), so
 * initials are derived from the leaf name instead of truncating an identifier
 * into something that looks like a different category's code.
 */
function displayCode(name: string): string {
  const words = (name.match(/[A-Za-z0-9]+/g) ?? []).filter(
    (word) => word.length > 1,
  );
  const raw =
    words.length > 1
      ? `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`
      : (words[0] ?? name).slice(0, 2);

  return raw.toUpperCase();
}

export function toStorefrontProduct(
  row: StorefrontListRow,
): StorefrontProduct | null {
  if (!isPublicSlug(row.slug)) return null;

  const category = row.categoryCode?.toLowerCase() ?? UNCATEGORISED_CODE;

  if (!isPublicSlug(category)) return null;

  const categoryName =
    row.categoryPath === null ? undefined : categoryLeafName(row.categoryPath);

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    priceMinor: row.priceMinor,
    oldPriceMinor: row.priceMinor,
    imageUrl: row.primaryImageUrl,
    // The product title, never an invented description of the photo. An empty
    // `alt` would fail the consumer's schema; a made-up one would mislead a
    // screen-reader user about what the image shows.
    imageAlt: row.title,
    ratingLine: NO_REVIEWS_LINE,
    shipLine: DELIVERY_AT_CHECKOUT_LINE,
    category,
    currency: row.priceCurrency,
    availability: row.availabilityState,
    ...(categoryName === undefined ? {} : { categoryName }),
  };
}

function toStorefrontVariant(
  variant: StorefrontVariant,
): StorefrontProductVariant {
  return {
    id: variant.id,
    sku: variant.sku,
    priceMinor: variant.priceMinor,
    currency: variant.currency,
    availability: variant.availability,
    ...(variant.options.length === 0 ? {} : { options: variant.options }),
  };
}

export function toStorefrontProductDetail(
  row: StorefrontDetailRow,
): StorefrontProductDetail | null {
  const base = toStorefrontProduct(row);

  if (base === null) return null;

  return {
    ...base,
    publishedAt: row.publishedAt,
    ...(row.categoryPath === null ? {} : { categoryPath: row.categoryPath }),
    // The product title as alt text for every photo. Numbering them ("image 2
    // of 5") would describe the gallery, not the picture; inventing a
    // description of each one would be a claim about content nobody looked at.
    images: row.images.map((image) => ({ url: image.url, alt: row.title })),
    ...(row.description === undefined
      ? {}
      : { description: { blocks: row.description.blocks } }),
    ...(row.variants === undefined
      ? {}
      : { variants: row.variants.map(toStorefrontVariant) }),
    ...(row.specs === undefined ? {} : { specs: row.specs }),
  };
}

export function toStorefrontProductFeed(
  page: StorefrontPage,
  query: StorefrontFeedQuery,
): StorefrontProductFeed {
  return {
    products: page.rows
      .map(toStorefrontProduct)
      .filter((product): product is StorefrontProduct => product !== null),
    total: page.total,
    page: query.page,
    limit: query.limit,
    // The same denominator the rows were paged with. The CJ-backed feed
    // reported CJ's own page count here while serving `limit`-sized pages,
    // so the consumer's pagination control offered pages that did not exist.
    totalPages: Math.max(1, Math.ceil(page.total / query.limit)),
  };
}

export function toStorefrontCategories(
  rows: readonly StorefrontCategoryRow[],
): StorefrontCategory[] {
  const byId = new Map<string, StorefrontCategory>();

  rows.forEach((row) => {
    const id = row.code.toLowerCase();

    if (!isPublicSlug(id) || byId.has(id)) return;

    const name = categoryLeafName(row.path);

    byId.set(id, { id, code: displayCode(name), name });
  });

  return [...byId.values()];
}
