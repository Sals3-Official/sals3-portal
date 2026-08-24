import { z } from 'zod';
import type { DescriptionBlock } from '@/modules/catalog/products/description-document';
import { slugBaseFromTitle } from '@/modules/catalog/products/slug';
import type { RatingSummary } from '@/modules/reviews/contracts';
import type {
  StorefrontCategoryRow,
  StorefrontDepartmentRow,
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

export const storefrontDepartmentSortSchema = z.enum([
  'newest',
  'price-asc',
  'price-desc',
]);

/**
 * A price bound in minor units.
 *
 * Capped rather than unbounded: the column is a `bigint`, and a bound past
 * `Number.MAX_SAFE_INTEGER` would be compared as a rounded float. The cap is
 * far above any real catalogue price, so it clamps nothing a seller could
 * legitimately list — it only refuses a bound that could not have come from
 * the price filter's own controls.
 */
const MAX_PRICE_MINOR = 1_000_000_000;

const priceBoundSchema = z.coerce
  .number()
  .int()
  .min(0)
  .max(MAX_PRICE_MINOR)
  .optional()
  .catch(undefined);

/**
 * The category browse query.
 *
 * Separate from `storefrontFeedQuerySchema` because the two surfaces narrow
 * differently: the home feed takes a `section`, which is an ordering over the
 * whole catalogue, while this takes a sort and a price window inside one
 * department. Sharing one schema would give each route parameters it has no
 * meaning for.
 *
 * `.catch()` throughout, matching the feed schema: a junk query string degrades
 * to the default view rather than answering 400. A browse URL is something a
 * buyer edits, shares, and truncates, so the useful failure mode is "you get
 * the unfiltered department", not an error page.
 */
export const storefrontDepartmentQuerySchema = z.object({
  sort: storefrontDepartmentSortSchema.catch('newest').default('newest'),
  page: z.coerce.number().int().min(1).max(10_000).catch(1).default(1),
  limit: z.coerce.number().int().min(1).max(30).catch(30).default(30),
  minPriceMinor: priceBoundSchema,
  maxPriceMinor: priceBoundSchema,
});

export type StorefrontDepartmentFeedQuery = z.infer<
  typeof storefrontDepartmentQuerySchema
>;

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
 * Every published product has a real Sals3 category — `publishProduct`
 * refuses `SALS3_CATEGORY_REQUIRED`, which since 2026-08-20 also rejects a
 * CJ mirror code. This exists because the consumer's key is required and
 * a null would fail its regex, so a category-less row still renders instead of
 * taking the page down. It names the absence rather than guessing a category.
 */
const UNCATEGORISED_CODE = 'uncategorised';

/**
 * Matches the consumer's `truncatedText(60)` on `variants[].label`.
 *
 * Truncating here rather than letting the consumer do it keeps one authority over
 * what the wire carries — and the consumer truncates rather than rejects for the
 * same reason `title` does: one overlong supplier string must not cost the whole
 * product page.
 */
const MAX_VARIANT_LABEL_LENGTH = 60;

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
  /**
   * @deprecated Superseded by `rating`. Kept because the consumer's schema
   * still requires a non-empty string, and now **derived from `rating`** rather
   * than being a fixed non-claim — a payload whose two rating fields disagreed
   * would let either half be quoted as current.
   */
  ratingLine: string;
  /** @deprecated See the module doc. */
  shipLine: string;
  /**
   * Real Sals3 buyer ratings, omitted entirely when nobody has reviewed this
   * product. Never a supplier's: CJ's `listedNum` and `productComments` are
   * evidence about CJ's own marketplace (ADR-013 §7).
   */
  rating?: { average: number; count: number };
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
  /**
   * The seller's own answers to their category's attribute set, in the order
   * the editor asked for them.
   *
   * A **different kind of claim** from `specs`, which is why it is a different
   * key: these are the seller's declarations, `specs` is what the supplier
   * reported. The consumer must not merge them into one table under one
   * provenance line — doing so attributes the seller's own words to CJ.
   */
  specification?: StorefrontProductSpecification[];
  /**
   * The seller-edited page meta description. Hidden metadata only: never
   * rendered in the page body, and it outranks the consumer's own fallback
   * chain when present.
   */
  metaDescription?: string;
  /**
   * The star distribution behind `rating.average`, index 0 being one star.
   * Detail only: a card shows an average, a product page shows the shape, and
   * sending five numbers with every card would grow the feed for nothing.
   */
  ratingBreakdown?: [number, number, number, number, number];
};

/** One seller-entered category attribute, already display-mapped by the portal. */
export type StorefrontProductSpecification = {
  /** The workbook's own attribute name, verbatim. */
  label: string;
  value: string;
};

export type StorefrontProductVariant = {
  id: string;
  sku: string;
  priceMinor: number;
  currency: string;
  availability: 'AVAILABLE' | 'UNKNOWN' | 'UNAVAILABLE';
  /** Omitted for a product with no option axes — one implicit variant. */
  options?: { name: string; value: string }[];
  /**
   * The supplier's own variant label, verbatim — e.g. `Black-1XL`.
   *
   * Omitted when the supplier reported none. **Never parsed into option axes**:
   * choosing which token is a colour and which a size is a guess, and a wrong
   * guess becomes a customer-facing product attribute.
   *
   * This is unreviewed supplier text on its way to a buyer, with no analogue of
   * ADR-011's media review gates — expect `default`, CJK, and junk. Truncation
   * happens here rather than in the consumer so this file stays the single
   * authority on what the wire carries.
   */
  label?: string;
  /**
   * The photo to show while this variant is the buyer's selection.
   *
   * Omitted when the variant's own option group carries none, which is the
   * ordinary case — a consumer that omits this field renders the product
   * gallery exactly as it did before the field existed, so adopting it is
   * optional on the consumer's side and adds no empty state.
   *
   * Already resolved per group by the producer (`shareFirstAxisPhotos`), so
   * every variant sharing a leading option value reports the same address and a
   * consumer must not re-derive that. The address is allow-listed at its write
   * boundary and is the same host family as `images[]`, so it needs no separate
   * entry in the consumer's `next.config.ts`.
   */
  imageUrl?: string;
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

/**
 * The legacy one-line rating, now a rendering of the real aggregate.
 *
 * When nobody has reviewed the product this still reads "No reviews yet", which
 * is the same non-claim it always was. When somebody has, it says so — because
 * shipping `rating: {average: 4.6}` beside `ratingLine: "No reviews yet"` would
 * put two contradictory answers in one payload, and either half could be quoted
 * as current.
 */
function ratingLineFor(rating: RatingSummary | undefined): string {
  if (rating === undefined || rating.count === 0) return NO_REVIEWS_LINE;

  return rating.count === 1
    ? `${rating.average.toFixed(1)} from 1 review`
    : `${rating.average.toFixed(1)} from ${rating.count} reviews`;
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
    ratingLine: ratingLineFor(row.rating),
    ...(row.rating === undefined
      ? {}
      : { rating: { average: row.rating.average, count: row.rating.count } }),
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
    ...(variant.label === undefined
      ? {}
      : { label: variant.label.slice(0, MAX_VARIANT_LABEL_LENGTH) }),
    ...(variant.imageUrl === undefined ? {} : { imageUrl: variant.imageUrl }),
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
    ...(row.rating === undefined
      ? {}
      : { ratingBreakdown: row.rating.breakdown }),
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
    ...(row.specification === undefined
      ? {}
      : { specification: row.specification }),
    ...(row.metaDescription === undefined
      ? {}
      : { metaDescription: row.metaDescription }),
  };
}

/**
 * `query` is constrained to the two keys this actually reads, so the home feed
 * and the department browse can share one envelope without either pretending to
 * carry the other's parameters. Generic rather than a `Pick`, so a caller may
 * pass its own fuller query object without tripping an excess-property check.
 */
export function toStorefrontProductFeed<
  Query extends Pick<StorefrontFeedQuery, 'page' | 'limit'>,
>(page: StorefrontPage, query: Query): StorefrontProductFeed {
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

/**
 * The top (L1) segment of a taxonomy path — "Apparel & Accessories" for
 * "Apparel & Accessories > Clothing > Dresses".
 *
 * Splits on `/` as well as `>`: auto-mirrored CJ rows write their path with
 * either separator ("Women's Clothing / Tops & Sets / Sweaters"), and a tile
 * showing a whole supplier path instead of a department name is the failure
 * this guards.
 */
export function categoryTopName(path: string): string {
  const segments = path
    .split(/[>/]/)
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '');

  return segments[0] ?? path;
}

/**
 * The public id for a main category.
 *
 * Not the taxonomy code: a `cat-ggl-5079` URL names a Google leaf id, which
 * is neither readable nor stable across a taxonomy refresh. The reduction is
 * `slugBaseFromTitle`'s, reused rather than re-derived so a category id and a
 * product slug can never disagree about what "&" or "," becomes.
 */
export function toCategorySlug(name: string): string {
  return slugBaseFromTitle(name);
}

/**
 * The "All departments" list: every main category the taxonomy defines,
 * whether or not a product is published under it.
 *
 * Same `{ id, code, name }` shape as `toStorefrontCategories`, on purpose —
 * the consumer validates one category schema, and a department *is* a main
 * category. The two differ only in whether stock is required.
 */
export function toStorefrontDepartments(
  rows: readonly StorefrontDepartmentRow[],
): StorefrontCategory[] {
  const byId = new Map<string, StorefrontCategory>();

  rows.forEach((row) => {
    // `categoryTopName`, not a bare trim: the producer query already scopes
    // to the Sals3 taxonomy, and this is the second line of defence against a
    // row that stored a whole path in the department column.
    const name = categoryTopName(row.l1);
    const id = toCategorySlug(name);

    if (!isPublicSlug(id) || byId.has(id)) return;

    byId.set(id, { id, code: displayCode(name), name });
  });

  return [...byId.values()];
}

/**
 * The **main** (L1) categories that have at least one published product,
 * derived by rolling every published leaf up to the top of its path.
 *
 * The rows are per-leaf, and the leaf set of a CJ-mirrored taxonomy is 5,595
 * rows deep — browsing it directly puts "Rangefinders" next to "Breast Milk
 * Storage Containers" and can never have a complete icon set. Grouping at L1
 * gives the storefront ~21 possible tiles, each with a name a buyer
 * recognises, while keeping the invariant that no tile can be empty: a
 * category only appears here because a published product is under it.
 *
 * The leaf itself is not lost — `toStorefrontProduct` still carries the leaf
 * code per product, and the detail row carries the full path for a breadcrumb.
 */
export function toStorefrontCategories(
  rows: readonly StorefrontCategoryRow[],
): StorefrontCategory[] {
  const byId = new Map<string, StorefrontCategory>();

  rows.forEach((row) => {
    const name = categoryTopName(row.path);
    const id = toCategorySlug(name);

    if (!isPublicSlug(id) || byId.has(id)) return;

    byId.set(id, { id, code: displayCode(name), name });
  });

  return [...byId.values()];
}
