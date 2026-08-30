import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  like,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import getDb, { type DbExecutor } from '@/lib/db/client';
import type { RatingSummary } from '@/modules/reviews/contracts';
import { readSoldUnitsForProducts } from '@/modules/orders/seller-sold-read';
import { readRatingSummaries } from '@/modules/reviews/repository';
import SALS3_TAXONOMY_DEPARTMENTS from '@/modules/catalog/taxonomy/departments';
import {
  productMediaSources,
  productOffers,
  productOptions,
  productOptionValues,
  productRevisions,
  products,
  productVariantOptionValues,
  productVariants,
  providerVariantReferences,
  sals3Categories,
} from '@/lib/db/schema';
import {
  initialDescriptionMode,
  publishableBlocks,
} from '@/lib/products/simple-description';
import {
  descriptionDocumentSchema,
  type DescriptionDocument,
} from '@/modules/catalog/products/description-document';
import {
  loadSpecification,
  type StorefrontSpecification,
} from '@/modules/catalog/storefront/specification';

/**
 * The public storefront's read model — the only query path behind
 * `/api/storefront/*`.
 *
 * ## Two rules this module exists to enforce
 *
 * **No supplier call.** Every value here comes from the Sals3 catalogue
 * tables. `sals3-ecommerce` used to be served a live CJ `/product/list`
 * response on every uncached buyer request, which made the public storefront
 * depend on CJ's uptime, spend CJ points per page view, and — most
 * importantly — meant nothing a seller did in the Portal ever reached a
 * buyer. Owner decision 2026-08-13: the storefront reads the database and
 * nothing else. `storefront/no-supplier-calls.test.ts` asserts the import
 * graph, so this is checked rather than remembered.
 *
 * **Publication is the gate, and it lives in the `WHERE` clause.** Not a
 * post-`filter` in JavaScript: a predicate that can be forgotten at one call
 * site is not a gate. Five conditions have to hold together before a row is
 * public, and they are listed once, in `publishedScope()`, shared by the list
 * query and its `count`.
 *
 * ## What is deliberately NOT filtered
 *
 * There is **no tenant filter**. The public catalogue is cross-seller on
 * purpose — a buyer has no seller identity to scope to, and filtering to one
 * `seller_account_id` would silently hide another seller's genuinely live
 * product with no rule anywhere saying it should be hidden. `publication_state`
 * is the authority.
 *
 * There is also **no `market_code` filter**. Adding one means reading a
 * destination from the request and validating it against
 * `resolveBuyerDestinationCountryPolicy()`, not hardcoding a constant here.
 * Until that exists, every published offer is visible and the cheapest one
 * prices the card.
 *
 * ## Why no `server-only` guard
 *
 * Same reason as `lib/security/step-up-challenge-core.ts`: `server-only`'s
 * default export throws unconditionally outside Next's bundler condition,
 * which would make this module untestable from Vitest — and its scope is
 * exactly what most needs a test. The guard lives on the app-facing
 * re-export, `lib/storefront/catalog-cache.ts`, and `getDb()` throws on any
 * client import besides.
 */

export type StorefrontSection = 'for-you' | 'deals';

export type StorefrontListRow = {
  id: string;
  slug: string;
  title: string;
  priceMinor: number;
  priceCurrency: string;
  availabilityState: 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE';
  categoryCode: string | null;
  categoryPath: string | null;
  primaryImageUrl: string | null;
  /** ISO 8601. A `Date` here would not survive `unstable_cache`'s JSON round-trip. */
  publishedAt: string;
  /**
   * Buyer ratings, absent when nobody has reviewed this product.
   *
   * Absent rather than a zeroed summary: `{average: 0, count: 0}` renders as a
   * nought-star product unless every consumer remembers to special-case it,
   * while an absent key cannot be mistaken for a verdict.
   */
  rating?: RatingSummary;
  /**
   * Units sold, absent until at least one has. Absent rather than zero for the
   * same reason `rating` is: a card that announces "0 sold" on a young
   * catalogue reads as "nobody buys here", which is a verdict the data does not
   * support. The consumer decides what an absent key renders as.
   */
  soldUnits?: number;
};

export type StorefrontPage = {
  rows: StorefrontListRow[];
  total: number;
};

export type StorefrontImage = { url: string };

export type StorefrontVariant = {
  id: string;
  sku: string;
  priceMinor: number;
  currency: string;
  availability: 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE';
  /** Empty for a product with no option axes — one implicit variant. */
  options: { name: string; value: string }[];
  /**
   * The supplier's own variant label, verbatim — e.g. `Black-1XL`.
   *
   * Absent when the supplier reported none, or when the variant has no provider
   * reference row at all (a hand-created variant). **Never split into option
   * axes**: deciding which token is a colour and which a size is a guess, and a
   * wrong guess becomes a customer-facing product attribute
   * (`create-draft.ts` records the same rule at the write side).
   */
  label?: string;
  /**
   * The photo to show when this variant is the buyer's current selection.
   *
   * Absent when nothing in the variant's own option group carries one, which is
   * the normal case — a product page falls back to the gallery it already has,
   * and a consumer that ignores this field renders exactly what it rendered
   * before the field existed.
   *
   * ## It is a group's photo, not strictly this row's
   *
   * `product_media_sources.variant_id` is one column and
   * `product_media_sources_product_checksum_key` makes one file unrepeatable
   * inside a product, so a single photo genuinely cannot belong to the four
   * variants carrying `Black`. The Portal's own control writes it to the first
   * variant of the group and says so. Serving only that row's own photo would
   * put a picture on `Black · S` and nothing on `Black · M`, which reads to a
   * buyer as a broken page rather than as a storage detail — so a variant with
   * no photo of its own inherits one from a variant sharing its **first option
   * axis** (`shareFirstAxisPhotos` below).
   *
   * That axis is whichever the seller arranged first, not a colour: Sals3 does
   * not know which axis carries appearance, and guessing is the same mistake
   * `label` exists to avoid. First is the one the seller led with, and a seller
   * who leads with Size gets size photos, which is a defensible answer to a
   * question nobody else can answer either.
   */
  imageUrl?: string;
};

export type StorefrontDescription = {
  blocks: DescriptionDocument['blocks'];
};

export type StorefrontSpecs = {
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

/**
 * One product's full detail. Every optional field is **absent** when its rows
 * do not exist, never defaulted — the consumer renders a section only when it
 * has something real to put in it.
 */
export type StorefrontDetailRow = StorefrontListRow & {
  images: StorefrontImage[];
  description?: StorefrontDescription;
  variants?: StorefrontVariant[];
  specs?: StorefrontSpecs;
  /**
   * The seller's own answers to their category's attribute set. Separate from
   * `specs` on purpose — see `specification.ts` for why one table cannot carry
   * both without misattributing a seller declaration to the supplier.
   */
  specification?: StorefrontSpecification[];
  /**
   * The seller-edited `<meta name="description">`.
   *
   * Hidden metadata, **not** the visible description: the consumer must never
   * render it in the page body, and must never substitute the visible
   * description for it when this is present.
   */
  metaDescription?: string;
};

/** Bounds one gallery. Beyond this nobody scrolls and nobody reviews. */
const MAX_DETAIL_IMAGES = 12;

export type StorefrontCategoryRow = {
  code: string;
  path: string;
};

/** One main (L1) department of the taxonomy. */
export type StorefrontDepartmentRow = {
  l1: string;
};

/**
 * The five conditions that together make one row public. Any single one
 * missing is a bug that publishes something, so they are written once and
 * reused by both the page query and the count.
 *
 * - `publication_state = 'PUBLISHED'` — the product itself is live.
 * - `slug IS NOT NULL` — enforced by `products_published_requires_slug` too,
 *   but repeated here because the slug is the public URL and a null one would
 *   produce an unreachable card.
 * - `publish_state = 'PUBLISHED'` + `pricing_state = 'RESOLVED'` +
 *   `price_amount_minor IS NOT NULL` — there is a real, explainable price.
 *   `product_offers_published_requires_price` already forbids a priced-less
 *   published offer; asserting it in the read too means a future schema
 *   relaxation cannot leak an unpriced card.
 * A published offer is the sellable gate. `Publish with Attention` can expose
 * a priced CJ-backed draft variant before full Sals3 option mapping exists.
 */
function publishedScope() {
  return and(
    eq(products.publicationState, 'PUBLISHED'),
    isNotNull(products.slug),
    isNotNull(products.publishedAt),
    eq(productOffers.publishState, 'PUBLISHED'),
    eq(productOffers.pricingState, 'RESOLVED'),
    isNotNull(productOffers.priceAmountMinor),
  );
}

/**
 * True when the product has at least one approved, renderable photo the seller
 * uploaded themselves **into the gallery** — `variant_id is null`. Correlated
 * on `products.id`, so it works both inside the card's `primaryImageUrl`
 * subquery and joined in `loadApprovedImages`.
 *
 * ## Why `variant_id is null` is load-bearing here
 *
 * This predicate is the *only* thing that lets `show_supplier_photo` off hide
 * the supplier's original (owner decision 2026-08-20: an empty gallery falls
 * back to the supplier photo rather than rendering a blank page). Since
 * `loadApprovedImages` serves the gallery from product-level rows alone, a
 * product whose every seller upload is a variation photo has **no gallery
 * photo of its own** — and counting those variation photos here would let the
 * switch hide the supplier original while leaving nothing to show in its
 * place. That is precisely the blank page the owner's decision forbids, so the
 * budget this reads has to be the same budget the gallery serves from.
 */
const hasApprovedSellerUpload = sql`exists (
  select 1
  from ${productMediaSources} as seller_media
  where seller_media.product_id = ${products.id}
    and seller_media.variant_id is null
    and seller_media.source_type = 'SELLER_UPLOAD'
    and seller_media.review_state = 'APPROVED'
    and seller_media.rights_basis <> 'UNKNOWN'
    and seller_media.source_url is not null
)`;

/**
 * Which approved media rows a buyer may actually see, honouring the editor's
 * "Show supplier photo" switch (`products.show_supplier_photo`):
 *
 * - A seller's own upload always shows.
 * - The supplier's original shows while the switch is on — the default.
 * - The switch off hides the supplier's original **only once a seller upload
 *   exists**. With nothing uploaded yet the supplier photo still renders,
 *   because publish requires approved media and a deliberately imageless
 *   product page misleads harder than the fallback the editor's own caption
 *   already promises ("Buyers see the supplier's photo until you upload your
 *   own").
 */
const mediaVisibleToBuyers = sql`(
  ${productMediaSources.sourceType} = 'SELLER_UPLOAD'
  or ${products.showSupplierPhoto}
  or not ${hasApprovedSellerUpload}
)`;

/**
 * Seller uploads outrank the supplier's originals — the same precedence the
 * editor's draft preview shows (`[...media, ...supplierMedia]`), so the cover
 * a seller sees there is the cover a buyer gets.
 */
const sellerUploadsFirst = sql`(${productMediaSources.sourceType} = 'SELLER_UPLOAD') desc`;

/**
 * The seller's own arrangement, when they have made one (ADR-011 amendment
 * 2026-08-28).
 *
 * `nulls last`, and that is the entire backwards-compatibility story: `position`
 * is null on every row written before the column existed, so a product nobody
 * has arranged falls straight through to `sellerUploadsFirst` and the observation
 * order underneath it — byte-identical to what it served yesterday. No backfill
 * had to invent an order the seller never chose.
 *
 * It sorts **ahead of** `sellerUploadsFirst`, which is deliberate and is the
 * point of the amendment: a seller who drags a supplier photo to the front means
 * it, and a rule that silently promoted their own upload above it would be the
 * editor overruling the control it just offered. On an unarranged product the
 * old precedence still decides everything.
 */
const sellerArrangementFirst = sql`${productMediaSources.position} asc nulls last`;

/**
 * One variant's own photo, under the same visibility rules as the cover.
 *
 * A correlated scalar subquery rather than a join, so it cannot multiply the
 * variant × option rows `loadPublishedVariants` folds — a variant with three
 * assigned photos must stay one row with one address, not become three rows
 * that quietly triple its option list.
 *
 * `variant_id` is the only difference from `primaryImageUrl`: same
 * `APPROVED`/rights/`mediaVisibleToBuyers` gate, same seller-uploads-first
 * precedence, same `coalesce(stored_url, source_url)` so a mirrored copy is
 * served over the supplier's CDN address once one has been taken. There is no
 * `(variant_id is null)` term here, because the whole point of this subquery is
 * the rows that *have* one.
 */
const variantImageUrl = sql<string | null>`(
  select coalesce(${productMediaSources.storedUrl}, ${productMediaSources.sourceUrl})
  from ${productMediaSources}
  where ${productMediaSources.variantId} = ${productVariants.id}
    and ${productMediaSources.reviewState} = 'APPROVED'
    and ${productMediaSources.rightsBasis} <> 'UNKNOWN'
    and ${productMediaSources.sourceUrl} is not null
    and ${mediaVisibleToBuyers}
  order by ${sellerUploadsFirst},
           ${productMediaSources.observedAt} asc,
           ${productMediaSources.id} asc
  limit 1
)`;

/**
 * One product's display image: the first approved media row a buyer may see
 * (`mediaVisibleToBuyers`), seller uploads before supplier originals,
 * product-level before variant-level, oldest observation first so the choice
 * is stable across requests rather than whatever the planner returns.
 *
 * Unlike `loadApprovedImages`, `variant_id is null` stays a *sort* term here
 * rather than becoming a filter. The gallery is a set and may legitimately be
 * short; a card is one image and an empty one is a hole in a grid. So a product
 * with no product-level photo a buyer may see still gets a card image from a
 * variation photo, as a last resort. In practice the two agree: draft creation
 * and publication both project the supplier's own photo as a product-level
 * `SUPPLIER_ORIGINAL` row, and `hasApprovedSellerUpload` now refuses to let the
 * supplier switch hide it unless a product-level seller upload exists to take
 * its place — so the fallback is reachable only for a product that never had a
 * supplier photo at all.
 *
 * `review_state = 'APPROVED'` and `rights_basis <> 'UNKNOWN'` are both
 * required. `product_media_sources_approved_requires_rights` makes the pair
 * consistent at write time; requiring both here means a public image always
 * has a recorded rights basis behind it (ADR-011 §6), and a product whose
 * media has not been reviewed renders a placeholder rather than a supplier
 * asset nobody cleared.
 *
 * `coalesce(stored_url, source_url)` prefers the durable Sals3 copy when one has
 * been taken (`mirror-supplier-media.ts`) and falls back to the observed
 * supplier address when it has not. Both are allow-listed at their own write
 * boundary — R2 by construction for a stored copy, the CJ host list for an
 * observed one — so this needs no third check, and it means a photo CJ later
 * replaces stops being what a buyer is served.
 */
const primaryImageUrl = sql<string | null>`(
  select coalesce(${productMediaSources.storedUrl}, ${productMediaSources.sourceUrl})
  from ${productMediaSources}
  where ${productMediaSources.productId} = ${products.id}
    and ${productMediaSources.reviewState} = 'APPROVED'
    and ${productMediaSources.rightsBasis} <> 'UNKNOWN'
    and ${productMediaSources.sourceUrl} is not null
    and ${mediaVisibleToBuyers}
  order by ${sellerArrangementFirst},
           ${sellerUploadsFirst},
           (${productMediaSources.variantId} is null) desc,
           ${productMediaSources.observedAt} asc,
           ${productMediaSources.id} asc
  limit 1
)`;

/**
 * The lowest published price across a product's offers, in minor units.
 *
 * Typed as `string` because `price_amount_minor` is a `bigint` column and
 * `postgres.js` returns aggregates over it as text. It is converted at this
 * boundary rather than downstream, because the cached value is persisted with
 * `JSON.stringify`, which throws on a real `bigint`.
 */
const lowestPriceMinor = sql<
  string | null
>`min(${productOffers.priceAmountMinor})`;

/**
 * The currency belonging to that lowest price — not `min(price_currency)`,
 * which would be alphabetically smallest and could pair an amount with a
 * different currency's code the moment two markets are published.
 */
const lowestPriceCurrency = sql<string | null>`(
  array_agg(${productOffers.priceCurrency} order by ${productOffers.priceAmountMinor} asc)
)[1]`;

/**
 * `AVAILABLE` wins over `UNKNOWN`, which wins over `UNAVAILABLE`, when a
 * product has several published offers. Folded in SQL rather than in a JS
 * reduce so it survives the `GROUP BY` — the alternative is fetching every
 * offer row per product just to collapse three enum values.
 */
const availabilityState = sql<'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE'>`
  case
    when bool_or(${productOffers.availabilityState} = 'AVAILABLE') then 'AVAILABLE'
    when bool_or(${productOffers.availabilityState} = 'UNKNOWN') then 'UNKNOWN'
    else 'UNAVAILABLE'
  end`;

const LIST_SELECTION = {
  id: products.id,
  slug: products.slug,
  title: products.title,
  publishedAt: products.publishedAt,
  priceMinor: lowestPriceMinor,
  priceCurrency: lowestPriceCurrency,
  availabilityState,
  categoryCode: sql<string | null>`min(${sals3Categories.code})`,
  categoryPath: sql<string | null>`min(${sals3Categories.path})`,
  primaryImageUrl,
} as const;

function listBase(executor: DbExecutor) {
  return executor
    .select(LIST_SELECTION)
    .from(products)
    .innerJoin(
      productRevisions,
      eq(productRevisions.id, products.publishedRevisionId),
    )
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .innerJoin(productOffers, eq(productOffers.variantId, productVariants.id))
    .leftJoin(sals3Categories, eq(sals3Categories.id, products.categoryId));
}

type ListQueryRow = {
  id: string;
  slug: string | null;
  title: string;
  publishedAt: Date | null;
  priceMinor: string | null;
  priceCurrency: string | null;
  availabilityState: 'UNKNOWN' | 'AVAILABLE' | 'UNAVAILABLE';
  categoryCode: string | null;
  categoryPath: string | null;
  primaryImageUrl: string | null;
};

function toListRow(row: ListQueryRow): StorefrontListRow | null {
  // `publishedScope()` already excludes each of these, so a null here means
  // the scope and this mapper have drifted apart. Dropping the row keeps a
  // half-published product out of the feed instead of emitting `null` fields
  // the consumer's schema would reject for the whole page.
  if (row.slug === null || row.publishedAt === null) return null;
  if (row.priceMinor === null || row.priceCurrency === null) return null;

  const priceMinor = Number(row.priceMinor);

  if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0) return null;

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    priceMinor,
    priceCurrency: row.priceCurrency,
    availabilityState: row.availabilityState,
    categoryCode: row.categoryCode,
    categoryPath: row.categoryPath,
    primaryImageUrl: row.primaryImageUrl,
    publishedAt: row.publishedAt.toISOString(),
  };
}

/**
 * One page of published products.
 *
 * `LIMIT/OFFSET` on the caller's own `limit` — not a supplier page size. The
 * old CJ-backed feed passed `page` straight through to CJ while slicing to
 * `limit`, so at `limit=14` items 15–20 of every CJ page of 20 were
 * unreachable on any page number, and `totalPages` was computed from a
 * different denominator than the one being served. Real offsets remove the
 * class of bug, not just the instance.
 *
 * `section` is an ordering, never a claim:
 * - `for-you` — newest publication first.
 * - `deals` — cheapest first. This is **not** a discount: no `compare_at`
 *   price is read and none is published (ADR-003 forbids a was/now pair that
 *   no sale ever happened at).
 */
/**
 * Attaches rating summaries to rows that have one, in a single extra query.
 *
 * ## Why this is a separate query and not a join
 *
 * A join would fan one product into one row per review, on top of the
 * offer/variant fan-out `listBase` already carries — the same over-counting
 * `listPublishedProducts` already works around for its own total. One grouped
 * lookup keyed by product id avoids that and costs one statement per page, not
 * one per card.
 *
 * ## Why a failure here does not fail the read
 *
 * A rating is decorative. A card without stars is a card; a catalogue that
 * answers 503 is a shop nobody can buy from, which is exactly what PR #102
 * produced when a feature's tables were missing in production. So a failure is
 * logged once and the products are returned without ratings.
 *
 * This is **not** a substitute for running the migration before deploying. It
 * exists because the blast radius of an optional aggregate should be the
 * aggregate, and because that is true of any decorative read — not because a
 * missing table here is expected or acceptable.
 */
async function safeRatingSummaries(
  productIds: string[],
  executor: DbExecutor,
): Promise<Map<string, RatingSummary>> {
  try {
    return await readRatingSummaries(productIds, executor);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[storefront] rating summaries unavailable', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return new Map();
  }
}

/**
 * Units sold, under the same failure rule as the ratings above.
 *
 * The order tables reach a deployed database through a break-glass workflow
 * rather than through the deploy, so a catalogue read must survive their
 * absence. A sold count is decorative in exactly the sense a rating is: a card
 * without one is still a card, and a shop that answers 503 because an optional
 * aggregate could not be counted is the PR #102 failure again.
 */
async function safeSoldUnits(
  productIds: string[],
  executor: DbExecutor,
): Promise<Map<string, number>> {
  try {
    return await readSoldUnitsForProducts(productIds, executor);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[storefront] sold counts unavailable', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return new Map();
  }
}

/**
 * Attaches both card aggregates - rating and units sold - in two grouped
 * lookups, neither of which can fail the read.
 *
 * Both are omitted rather than zeroed when there is nothing to say, so a
 * consumer cannot mistake "we have no figure" for "the figure is nought".
 */
async function withCardAggregates(
  rows: StorefrontListRow[],
  executor: DbExecutor,
): Promise<StorefrontListRow[]> {
  if (rows.length === 0) return rows;

  const productIds = rows.map((row) => row.id);
  const [summaries, soldUnits] = await Promise.all([
    safeRatingSummaries(productIds, executor),
    safeSoldUnits(productIds, executor),
  ]);

  return rows.map((row) => {
    const rating = summaries.get(row.id);
    const sold = soldUnits.get(row.id) ?? 0;

    return {
      ...row,
      ...(rating === undefined || rating.count === 0 ? {} : { rating }),
      ...(sold > 0 ? { soldUnits: sold } : {}),
    };
  });
}

/**
 * One product's rating, for the detail path.
 *
 * Kept separate from `withCardAggregates` so it can ride the detail loader's existing
 * `Promise.all` rather than adding a serial round trip before it — and so it
 * cannot shift the query order `read-model.published-scope.test.ts` reads by
 * index. That test's own note says a loader appended to that list is safe;
 * a query issued *before* it is not.
 */
async function loadRatingSummary(
  executor: DbExecutor,
  productId: string,
): Promise<RatingSummary | undefined> {
  const summaries = await safeRatingSummaries([productId], executor);
  const rating = summaries.get(productId);

  return rating === undefined || rating.count === 0 ? undefined : rating;
}

export async function listPublishedProducts(
  input: { section: StorefrontSection; page: number; limit: number },
  executor: DbExecutor = getDb(),
): Promise<StorefrontPage> {
  const scope = publishedScope();
  const grouped = listBase(executor).where(scope).groupBy(products.id);
  const ordered =
    input.section === 'deals'
      ? grouped.orderBy(asc(lowestPriceMinor), asc(products.id))
      : grouped.orderBy(desc(products.publishedAt), asc(products.id));

  const [rows, totals] = await Promise.all([
    ordered.limit(input.limit).offset((input.page - 1) * input.limit),
    // Distinct products, not offer rows: the joins fan out one product into
    // one row per published offer, so `count()` would over-report the total
    // and invent pages that render empty.
    executor
      .select({ total: count(sql`distinct ${products.id}`) })
      .from(products)
      .innerJoin(
        productRevisions,
        eq(productRevisions.id, products.publishedRevisionId),
      )
      .innerJoin(productVariants, eq(productVariants.productId, products.id))
      .innerJoin(productOffers, eq(productOffers.variantId, productVariants.id))
      .where(scope),
  ]);

  return {
    rows: await withCardAggregates(
      rows
        .map(toListRow)
        .filter((row): row is StorefrontListRow => row !== null),
      executor,
    ),
    total: totals[0]?.total ?? 0,
  };
}

export type StorefrontDepartmentSort = 'newest' | 'price-asc' | 'price-desc';

/**
 * Which slice of the taxonomy a browse covers.
 *
 * Two shapes because two different things are safe to interpolate, and both are
 * resolved from a URL segment by an allow-list rather than taken from it:
 *
 * - `departmentName` is an exact `sals3_categories.l1` value from
 *   `departmentNameForSlug` — the 21-entry whitelist.
 * - `categoryPath` is the full `sals3_categories.path` of a node the taxonomy
 *   extract actually contains, from `taxonomyCodeFromSlug` +
 *   `taxonomyPathForCode`. A path that is not in the extract never becomes one.
 *
 * Never a raw path segment in either case: that is the security boundary, and it
 * is why an unknown slug 404s rather than reaching a query.
 */
export type StorefrontCategoryScope =
  | { departmentName: string; categoryPath?: undefined }
  | { categoryPath: string; departmentName?: undefined };

export type StorefrontDepartmentQuery = StorefrontCategoryScope & {
  sort: StorefrontDepartmentSort;
  page: number;
  limit: number;
  /** Inclusive bounds on the card price, in minor units. */
  minPriceMinor?: number;
  maxPriceMinor?: number;
};

/**
 * The inclusive card-price bound, or `undefined` when neither end was given.
 *
 * `undefined` rather than an always-true comparison so an unfiltered browse
 * renders the same SQL it did before this filter existed.
 */
function listingPriceBound(input: {
  minPriceMinor?: number;
  maxPriceMinor?: number;
}) {
  const bounds = [
    input.minPriceMinor === undefined
      ? undefined
      : gte(lowestPriceMinor, input.minPriceMinor),
    input.maxPriceMinor === undefined
      ? undefined
      : lte(lowestPriceMinor, input.maxPriceMinor),
  ].filter((bound) => bound !== undefined);

  return bounds.length === 0 ? undefined : and(...bounds);
}

/** Every ordering is tie-broken on `products.id` so paging cannot repeat or skip a row. */
function listingOrderBy(sort: StorefrontDepartmentSort) {
  if (sort === 'price-asc') return [asc(lowestPriceMinor), asc(products.id)];
  if (sort === 'price-desc') return [desc(lowestPriceMinor), asc(products.id)];

  return [desc(products.publishedAt), asc(products.id)];
}

async function countGroupedProducts(
  executor: DbExecutor,
  scope: ReturnType<typeof publishedScope>,
  priceBound: ReturnType<typeof listingPriceBound>,
): Promise<number> {
  const matching = listBase(executor)
    .where(scope)
    .groupBy(products.id)
    .having(priceBound)
    .as('matching_products');
  const totals = await executor.select({ total: count() }).from(matching);

  return totals[0]?.total ?? 0;
}

/**
 * The taxonomy predicate for one browse scope.
 *
 * ## A department matches `l1`; a deeper node matches its subtree
 *
 * `l1` carries the department name verbatim and `sals3_categories_l1_idx`
 * indexes it, so a department stays the cheap equality it always was.
 *
 * A deeper node has no column of its own past `l5` and needs its descendants
 * anyway — browsing `Paper Products` should list what is filed under
 * `Notebooks & Notepads` too, or a category page shows nothing on a taxonomy
 * where products sit at the leaves. So it matches the node **or anything beneath
 * it** by path.
 *
 * `LIKE` with the separator appended rather than a bare prefix. Without the
 * `' > '`, a category named `Shoes` would also match `Shoes & Boots` — a
 * different branch of the tree. That is the same trap `reprice.ts` documents,
 * and it is the reason this is a shared helper rather than a second copy of the
 * expression.
 */
function categoryScopeCondition(scope: StorefrontCategoryScope): SQL {
  if (scope.categoryPath === undefined) {
    return eq(sals3Categories.l1, scope.departmentName) as SQL;
  }

  return or(
    eq(sals3Categories.path, scope.categoryPath),
    like(sals3Categories.path, `${scope.categoryPath} > %`),
  ) as SQL;
}

/**
 * Published products filed under one L1 department, filtered and paged.
 *
 * ## Why the price bound is a `HAVING`, not a `WHERE`
 *
 * The price on a card is `min(product_offers.price_amount_minor)` — an
 * aggregate over every published offer. A `WHERE` on the raw offer column
 * filters offer rows *before* grouping, so a product with a $10 and a $50 offer
 * would survive a "$15–$30" filter on neither, but a product with a $10 and a
 * $20 offer would survive on its $20 row and then render at $10 — a card
 * outside the band the buyer just selected, sitting in the results for that
 * band. Filtering the aggregate means the number that decides membership is the
 * same number the buyer sees.
 *
 * ## Why the department is matched on `l1` and not the path
 *
 * `l1` carries the department name verbatim for every workbook-seeded taxonomy
 * row, and `sals3_categories_l1_idx` indexes it. Auto-mirrored CJ rows put a
 * whole supplier path in `l1` (see `taxonomy/departments.ts`), so they simply
 * fail the equality rather than needing a second predicate to exclude them —
 * and a product filed under one was never reachable from a department tile
 * anyway, because `categoryTopName` would not reduce its path to a department
 * slug either.
 *
 * ## Why this is a separate function from `listPublishedProducts`
 *
 * It could have been optional arguments on that one. It is not, because that
 * query serves the live home page: its predicate is asserted condition by
 * condition, its count is asserted byte-identical to its list, and both are read
 * by index in `read-model.published-scope.test.ts`. Adding a grouped `HAVING`
 * and a subquery count to it would rewrite the shape those assertions describe,
 * to make a browse surface work. The two share `listBase`, `publishedScope`,
 * `toListRow` and `withCardAggregates` — everything that decides what is public — and
 * differ only in how they narrow and order it.
 */
export async function listPublishedProductsInDepartment(
  input: StorefrontDepartmentQuery,
  executor: DbExecutor = getDb(),
): Promise<StorefrontPage> {
  const scope = and(publishedScope(), categoryScopeCondition(input));
  const priceBound = listingPriceBound(input);

  const ordered = listBase(executor)
    .where(scope)
    .groupBy(products.id)
    .having(priceBound)
    .orderBy(...listingOrderBy(input.sort));

  const [rows, totals] = await Promise.all([
    ordered.limit(input.limit).offset((input.page - 1) * input.limit),
    // Counted over the same grouped, price-bounded set the page is drawn from.
    // `count(distinct products.id)` cannot be used here as it is in
    // `listPublishedProducts`: a `HAVING` on an aggregate needs the grouping to
    // exist, so the matching ids are grouped in a subquery and the rows of that
    // subquery are what gets counted.
    countGroupedProducts(executor, scope, priceBound),
  ]);

  return {
    rows: await withCardAggregates(
      rows
        .map(toListRow)
        .filter((row): row is StorefrontListRow => row !== null),
      executor,
    ),
    total: totals,
  };
}

export type StorefrontSearchQuery = {
  /** Already trimmed and length-bounded by `storefrontSearchQuerySchema`. */
  term: string;
  /**
   * Optional narrowing to one L1 department, resolved from a slug by
   * `departmentNameForSlug` — never a raw path segment.
   */
  departmentName?: string;
  sort: StorefrontDepartmentSort;
  page: number;
  limit: number;
  minPriceMinor?: number;
  maxPriceMinor?: number;
};

/**
 * `%` and `_` are wildcards to `LIKE`, so a buyer typing either would silently
 * widen their own search — `%` alone matching the entire catalogue. The value
 * is parameterised, so this is not an injection defence; it is the difference
 * between searching for the characters someone typed and searching for a
 * pattern they did not write. Backslash is escaped first, because it is the
 * escape character doing the escaping.
 */
function escapeLikePattern(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/[%_]/g, (char) => `\\${char}`);
}

/** `S3V-` and twelve hex characters, the shape `deriveSals3Sku` mints. */
const SALS3_SKU_PATTERN = /^(?:S3V-)?([0-9A-F]{12})$/;

/**
 * The Sals3 SKU a search term spells, or `null` when it does not spell one.
 *
 * Folded to upper case and accepting a missing `S3V-` because the code arrives
 * by copy and paste — out of the Portal, out of an order line, out of a message
 * — and none of those preserve a shape reliably. Anything that is not exactly
 * one SKU is not one: a term that merely *contains* a SKU is a sentence, and a
 * sentence is a title search.
 */
function sals3SkuFromTerm(term: string): string | null {
  const match = SALS3_SKU_PATTERN.exec(term.trim().toUpperCase());

  return match === null ? null : `S3V-${match[1]}`;
}

/**
 * Whether this product has any variant carrying that SKU.
 *
 * Correlated rather than joined so it narrows *which products match* without
 * touching what `listBase` aggregates over them. `product_variants_sals3_sku_key`
 * makes it a single unique-index probe per candidate row.
 *
 * Deliberately not scoped to published offers: publication is already decided by
 * `publishedScope()` on the product, and re-deciding it here would mean a SKU
 * search silently answering "no such product" for a product that is on sale
 * through a different variant.
 */
function hasVariantWithSku(sku: string) {
  return sql`EXISTS (
    SELECT 1 FROM ${productVariants}
    WHERE ${productVariants.productId} = ${products.id}
      AND ${productVariants.sals3Sku} = ${sku}
  )`;
}

/**
 * Published products whose title contains the term — or whose catalogue carries
 * it as a Sals3 SKU — newest first by default.
 *
 * ## Title, and one exact identifier
 *
 * It matches `products.title` and nothing else by substring. Not the category
 * name — a search for "electronics" would then return every product in the
 * department rather than the ones actually called that, and a buyer cannot tell
 * which of the two happened. Not the description either: a word buried in
 * supplier copy is not what someone searching for a product name means.
 *
 * The one addition is `product_variants.sals3_sku`, and it is **exact**, never a
 * substring. A Sals3 SKU is `S3V-` plus twelve hex characters derived from the
 * provider's identifiers, so a partial match is a hash prefix collision rather
 * than a shopper's intent — `S3V-4` is not a search, it is noise. A term is
 * treated as a SKU only when the whole of it is one, with the prefix optional
 * and case folded, because the code is copied out of the Portal and pasted here
 * by whoever is chasing a specific listing.
 *
 * It is an `EXISTS` rather than a join predicate on purpose. `listBase` already
 * joins the variants and aggregates over them, so narrowing that join to the
 * matched variant would quietly change the card's own figures: the `From` price
 * would become that variant's price instead of the product's floor, and the
 * availability roll-up would be computed from a single offer. A buyer who
 * searched a SKU should see the same card everyone else sees.
 *
 * Known gap, deliberate: this finds the *product*, not the variant. Search
 * returns product rows, so pasting a SKU lands on the product page with its
 * default option selected rather than the one the SKU names. Carrying the
 * matched variant through to a `?variant=` deep link means widening the list row
 * and the storefront feed, which is a larger change than this.
 *
 * `ILIKE '%term%'` is a substring match with no ranking, which is the honest
 * shape for the catalogue this serves. It is also the part to replace first:
 * with a large catalogue this cannot use an index and has no notion of a better
 * match, so it wants a `tsvector` column with a GIN index and
 * `websearch_to_tsquery` before the published count grows. Deliberately not
 * done now — that is a migration, and prod migrations here are applied by hand.
 *
 * Everything that decides what is *public* is shared with the rest of this
 * module: `publishedScope`, `listBase`, `toListRow`, `withCardAggregates`. Only the
 * narrowing differs.
 */
export async function searchPublishedProducts(
  input: StorefrontSearchQuery,
  executor: DbExecutor = getDb(),
): Promise<StorefrontPage> {
  const sku = sals3SkuFromTerm(input.term);
  const byTitle = ilike(products.title, `%${escapeLikePattern(input.term)}%`);
  const scope = and(
    publishedScope(),
    sku === null ? byTitle : or(byTitle, hasVariantWithSku(sku)),
    ...(input.departmentName === undefined
      ? []
      : [eq(sals3Categories.l1, input.departmentName)]),
  );
  const priceBound = listingPriceBound(input);

  const ordered = listBase(executor)
    .where(scope)
    .groupBy(products.id)
    .having(priceBound)
    .orderBy(...listingOrderBy(input.sort));

  const [rows, totals] = await Promise.all([
    ordered.limit(input.limit).offset((input.page - 1) * input.limit),
    countGroupedProducts(executor, scope, priceBound),
  ]);

  return {
    rows: await withCardAggregates(
      rows
        .map(toListRow)
        .filter((row): row is StorefrontListRow => row !== null),
      executor,
    ),
    total: totals,
  };
}

/**
 * One published product by its public slug.
 *
 * Resolved by slug, never by `products.id`: `sals3-ecommerce`'s
 * `fetchProductBySlug` puts the slug in the path (its route folder is named
 * `[id]` for historical reasons) and its cards link by slug. The predicate is
 * `publishedScope()` plus the slug, so "not a published product" and "no such
 * slug" are the same answer — the caller cannot distinguish an unpublished
 * product from a nonexistent one, which is the honest posture for a public
 * endpoint.
 */
/**
 * The product's gallery — the strip of photos a buyer actually scrolls.
 *
 * Same `mediaVisibleToBuyers` gate and seller-uploads-first precedence as the
 * card's single image, joined to `products` for `show_supplier_photo`; the join
 * cannot fan out because `product_id` references one row.
 *
 * ## Product-level rows only, and why that is the whole point
 *
 * `variant_id is null` is a **filter**, not a sort. Until 2026-08-28 it was
 * only the latter, and the difference was a real defect on the storefront: a
 * variation photo is stored as an ordinary `product_media_sources` row, so
 * every photo a seller tagged to a variant was silently also a slide in this
 * gallery. On a product that uses variation photos properly — the 21-design
 * `Knitted Tam Beanie` was the reported case — the gallery *became* twenty-one
 * near-identical close-ups of the option the buyer had not chosen yet. That is
 * exactly the outcome `media-projection.ts`'s own cap comment ("a page that
 * renders 40 thumbnails is a page nobody scrolls") was written to prevent,
 * arriving through a door that did not exist when it was written.
 *
 * Splitting the two is also what lets the gallery cap stay at the reviewed
 * `MAX_DETAIL_IMAGES` while a product carries one photo per variant: the
 * gallery is a curated set the seller chooses, and a variation photo reaches
 * the buyer through `variantImageUrl` — one per variant, `limit 1`, spread
 * across the first axis by `shareFirstAxisPhotos` — which never consumed a
 * slide here and never needed one. The two budgets are enforced at the write
 * side by `upload-seller-media.ts`.
 *
 * A consequence worth stating plainly: a seller who moves a photo from the
 * gallery onto a variation removes a slide from this gallery. That is the
 * model, not a loss — `assignVariantMedia` moves a pointer rather than copying,
 * so the photo has one home at a time, and the editor names the count of
 * variation photos beside the gallery so nothing disappears without a trace.
 */
async function loadApprovedImages(
  executor: DbExecutor,
  productId: string,
): Promise<StorefrontImage[]> {
  const rows = await executor
    // The durable copy first — same reasoning as `primaryImageUrl`.
    .select({
      url: sql<
        string | null
      >`coalesce(${productMediaSources.storedUrl}, ${productMediaSources.sourceUrl})`,
    })
    .from(productMediaSources)
    .innerJoin(products, eq(products.id, productMediaSources.productId))
    .where(
      and(
        eq(productMediaSources.productId, productId),
        isNull(productMediaSources.variantId),
        eq(productMediaSources.reviewState, 'APPROVED'),
        ne(productMediaSources.rightsBasis, 'UNKNOWN'),
        isNotNull(productMediaSources.sourceUrl),
        mediaVisibleToBuyers,
      ),
    )
    // No `(variant_id is null)` sort term: it is a predicate above now, so
    // every row here already satisfies it and sorting on it would order
    // nothing.
    .orderBy(
      sellerArrangementFirst,
      sellerUploadsFirst,
      asc(productMediaSources.observedAt),
      asc(productMediaSources.id),
    )
    .limit(MAX_DETAIL_IMAGES);

  return rows
    .map((row) => row.url)
    .filter((url): url is string => url !== null)
    .map((url) => ({ url }));
}

/**
 * The frozen description of the revision that was published — never the live
 * `content_document`, which a seller may have edited since.
 *
 * Returns `null` for an empty document, which is the current state of every
 * product: CJ's own `description` is unsanitised supplier HTML and this
 * repository has no sanitiser, so a CJ-sourced draft starts from an honestly
 * empty document that the seller fills in.
 */
async function loadDescriptionBlocks(
  executor: DbExecutor,
  productId: string,
): Promise<StorefrontDescription | null> {
  const rows = await executor
    .select({ snapshot: productRevisions.contentSnapshot })
    .from(products)
    .innerJoin(
      productRevisions,
      eq(productRevisions.id, products.publishedRevisionId),
    )
    .where(eq(products.id, productId))
    .limit(1);
  const parsed = descriptionDocumentSchema.safeParse(rows[0]?.snapshot);

  if (!parsed.success) return null;

  /*
   * The seller's chosen editor decides what publishes.
   *
   * Simple text publishes its paragraphs. A photo saved earlier in the designed
   * layout stays in the stored document — so switching layout again restores it
   * whole — but it is not part of what simple text shows, because a plain box
   * cannot place it and a buyer should see what the seller was looking at.
   *
   * `initialDescriptionMode` supplies the mode for a legacy document that predates
   * the field, so nothing stored before this change alters what it publishes.
   */
  const blocks = publishableBlocks(
    parsed.data.blocks,
    initialDescriptionMode(parsed.data.blocks, parsed.data.mode),
  );

  if (blocks.length === 0) return null;

  return { blocks };
}

/**
 * Two variants' places in the seller's arranged Variant Matrix.
 *
 * Compared axis by axis, so the first axis decides and later axes break its
 * ties — the reading order of a size chart. `sals3_sku` is the final tiebreak
 * rather than the primary sort it used to be: it is a hash, so ordering by it
 * showed buyers `L, M, S, XL, XXL` no matter how the matrix was arranged.
 *
 * A missing position sorts last. That is a variant whose option row could not
 * be read, and appending it is the one placement that never claims an order the
 * seller did not set.
 */
function compareMatrixOrder(
  left: readonly number[],
  right: readonly number[],
  leftSku: string,
  rightSku: string,
): number {
  const depth = Math.max(left.length, right.length);

  for (let axis = 0; axis < depth; axis += 1) {
    const a = left[axis] ?? Number.MAX_SAFE_INTEGER;
    const b = right[axis] ?? Number.MAX_SAFE_INTEGER;

    if (a !== b) return a - b;
  }

  return leftSku.localeCompare(rightSku);
}

/**
 * A variant with no photo of its own borrows one from its first-axis group.
 *
 * ## Why the wire carries the answer and not the raw column
 *
 * The Portal's group control sets `variant_id` on one variant per colour — it
 * has no choice, the column holds one id and the checksum index forbids a second
 * row for the same file. Handing a consumer that raw fact would make every
 * consumer re-derive this, and the first one to skip it ships a page where
 * `Black · S` has a photo and `Black · M` does not. Deriving it once, here,
 * beside the option positions that define a group, is the same argument that
 * put `rating` on the payload instead of a rollup: one answer that cannot
 * disagree with itself.
 *
 * ## Groups are positional, not by name
 *
 * `options` is already ordered by the seller's axis position when a variant is
 * folded, so `options[0]` is the leading axis and its `value` is the group key.
 * Keyed on `name` *and* `value` so two axes that happen to share a value —
 * `Colour: Natural` and `Material: Natural` — cannot pool their photos.
 *
 * A variant with no options at all is the single implicit variant of an
 * axis-less product; it has no group, keeps whatever it has, and borrows
 * nothing.
 *
 * ## Never overwrites
 *
 * A variant that carries its own photo keeps it. This only fills absences, so a
 * seller who does assign every size individually gets exactly what they
 * assigned, and this pass becomes invisible.
 */
export function shareFirstAxisPhotos(
  variants: StorefrontVariant[],
): StorefrontVariant[] {
  const groupPhoto = new Map<string, string>();

  variants.forEach((variant) => {
    const lead = variant.options[0];

    if (lead === undefined || variant.imageUrl === undefined) return;

    const key = `${lead.name} ${lead.value}`;

    // First in the seller's arranged order wins, which is the same variant the
    // Portal's group control writes to.
    if (!groupPhoto.has(key)) groupPhoto.set(key, variant.imageUrl);
  });

  if (groupPhoto.size === 0) return variants;

  return variants.map((variant) => {
    const lead = variant.options[0];

    if (lead === undefined || variant.imageUrl !== undefined) return variant;

    const inherited = groupPhoto.get(`${lead.name} ${lead.value}`);

    return inherited === undefined
      ? variant
      : { ...variant, imageUrl: inherited };
  });
}

/**
 * The published variants, each with the option values that identify it, in the
 * order the seller arranged them.
 *
 * A variant with no mapped options is still returned: it is the single implicit
 * variant of a product that has no axes, and the consumer renders no selector
 * for it. What is never returned is a variant whose offer is not published —
 * the same `publishedScope()` conditions apply per row.
 */
async function loadPublishedVariants(
  executor: DbExecutor,
  productId: string,
): Promise<StorefrontVariant[]> {
  const rows = await executor
    .select({
      id: productVariants.id,
      sku: productVariants.sals3Sku,
      priceMinor: productOffers.priceAmountMinor,
      priceCurrency: productOffers.priceCurrency,
      availability: productOffers.availabilityState,
      optionName: productOptions.name,
      optionValue: productOptionValues.label,
      optionPosition: productOptions.position,
      optionValuePosition: productOptionValues.position,
      // Only the label. `provider_variant_references` also holds
      // `external_variant_id`, `external_sku` and the observed supplier cost —
      // none of which may reach a public feed, so none of which is selected.
      supplierLabel: providerVariantReferences.sourceOptionLabel,
      imageUrl: variantImageUrl,
    })
    .from(productVariants)
    // `mediaVisibleToBuyers` reads `products.show_supplier_photo`, so the
    // product has to be in scope for `variantImageUrl` to compile. One row per
    // variant by the foreign key, so the fold below is unaffected.
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(productOffers, eq(productOffers.variantId, productVariants.id))
    // Safe to join without changing the row count: `variant_id` carries the
    // unique index `provider_variant_references_variant_key`, so this matches at
    // most one row per variant. `left`, not `inner`, because a variant created by
    // hand has no provider reference and must still be returned.
    .leftJoin(
      providerVariantReferences,
      eq(providerVariantReferences.variantId, productVariants.id),
    )
    .leftJoin(
      productVariantOptionValues,
      eq(productVariantOptionValues.variantId, productVariants.id),
    )
    .leftJoin(
      productOptions,
      eq(productOptions.id, productVariantOptionValues.optionId),
    )
    .leftJoin(
      productOptionValues,
      eq(productOptionValues.id, productVariantOptionValues.optionValueId),
    )
    .where(
      and(
        eq(productVariants.productId, productId),
        eq(productOffers.publishState, 'PUBLISHED'),
        eq(productOffers.pricingState, 'RESOLVED'),
        isNotNull(productOffers.priceAmountMinor),
      ),
    )
    .orderBy(asc(productVariants.sals3Sku), asc(productOptions.position));

  // One row per variant × option, folded back into one variant per id. Done in
  // JS rather than with an aggregate so the option order stays the seller's
  // `position` rather than whatever a string_agg produced.
  const byVariant = new Map<string, StorefrontVariant>();
  /**
   * Each variant's place in the seller's arranged matrix: the value position at
   * each axis position, so `Black · S` sorts before `Black · M` when the seller
   * arranged `S, M, L`.
   *
   * The rows arrive ordered by `sals3_sku`, which is a hash — buyers were shown
   * sizes in hash order however the Variant Matrix was arranged, which made the
   * portal's reordering purely cosmetic. Sorted here rather than in SQL because
   * the sort key spans one row per axis and only exists once the rows are
   * folded.
   */
  const orderKeys = new Map<string, number[]>();

  rows.forEach((row) => {
    const priceMinor = Number(row.priceMinor);

    if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0) return;
    if (row.priceCurrency === null) return;

    // A whitespace-only supplier label is the same as none: it would render an
    // empty chip the buyer cannot identify, so it is dropped rather than passed
    // on as a present-but-blank value.
    const supplierLabel = row.supplierLabel?.trim();
    const existing = byVariant.get(row.id) ?? {
      id: row.id,
      sku: row.sku,
      priceMinor,
      currency: row.priceCurrency,
      availability: row.availability,
      options: [],
      ...(supplierLabel === undefined || supplierLabel === ''
        ? {}
        : { label: supplierLabel }),
      ...(row.imageUrl === null ? {} : { imageUrl: row.imageUrl }),
    };

    if (row.optionName !== null && row.optionValue !== null) {
      existing.options.push({ name: row.optionName, value: row.optionValue });

      if (row.optionPosition !== null && row.optionValuePosition !== null) {
        const key = orderKeys.get(row.id) ?? [];

        key[row.optionPosition] = row.optionValuePosition;
        orderKeys.set(row.id, key);
      }
    }

    byVariant.set(row.id, existing);
  });

  return shareFirstAxisPhotos(
    [...byVariant.values()].sort((left, right) =>
      compareMatrixOrder(
        orderKeys.get(left.id) ?? [],
        orderKeys.get(right.id) ?? [],
        left.sku,
        right.sku,
      ),
    ),
  );
}

/**
 * Physical and identifier facts, assembled field by field.
 *
 * Every one is omitted when null. `weight_grams` and the dimensions are
 * supplier-reported, not Sals3-verified — the consumer is responsible for
 * labelling them as such. `gtins`, `mpn`, and `brand_name` are never invented
 * (ADR-013 §7); `brand_name` is only read when `brand_mode` says a brand was
 * actually declared.
 */
async function loadSpecs(
  executor: DbExecutor,
  productId: string,
): Promise<StorefrontSpecs | null> {
  const rows = await executor
    .select({
      sku: productVariants.sals3Sku,
      weightGrams: productVariants.weightGrams,
      lengthMillimeters: productVariants.lengthMillimeters,
      widthMillimeters: productVariants.widthMillimeters,
      heightMillimeters: productVariants.heightMillimeters,
      gtins: productVariants.gtins,
      mpn: productVariants.mpn,
      brandMode: products.brandMode,
      brandName: products.brandName,
      condition: products.condition,
    })
    .from(products)
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .innerJoin(productOffers, eq(productOffers.variantId, productVariants.id))
    .where(
      and(
        eq(products.id, productId),
        eq(productOffers.publishState, 'PUBLISHED'),
        eq(productOffers.pricingState, 'RESOLVED'),
        isNotNull(productOffers.priceAmountMinor),
      ),
    )
    .orderBy(asc(productVariants.sals3Sku))
    .limit(1);
  const row = rows[0];

  if (row === undefined) return null;

  const specs: StorefrontSpecs = {
    ...(row.sku === null ? {} : { sku: row.sku }),
    ...(row.weightGrams === null ? {} : { weightGrams: row.weightGrams }),
    ...(row.lengthMillimeters === null
      ? {}
      : { lengthMillimeters: row.lengthMillimeters }),
    ...(row.widthMillimeters === null
      ? {}
      : { widthMillimeters: row.widthMillimeters }),
    ...(row.heightMillimeters === null
      ? {}
      : { heightMillimeters: row.heightMillimeters }),
    ...(row.gtins === null || row.gtins.length === 0
      ? {}
      : { gtins: row.gtins }),
    ...(row.mpn === null ? {} : { mpn: row.mpn }),
    ...(row.brandMode === 'DECLARED' && row.brandName !== null
      ? { brand: row.brandName }
      : {}),
    ...(row.condition === null ? {} : { condition: row.condition }),
  };

  return Object.keys(specs).length === 0 ? null : specs;
}

/**
 * The seller's own `<meta name="description">`, when they have written one.
 *
 * A blank string is treated as absent: the column is nullable precisely so an
 * unset value means "not decided yet", and an empty string reaching the
 * consumer would beat its own fallback chain and produce a page with no meta
 * description at all.
 */
async function loadMetaDescription(
  executor: DbExecutor,
  productId: string,
): Promise<string | null> {
  const rows = await executor
    .select({ metaDescription: products.metaDescription })
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);
  const value = rows[0]?.metaDescription?.trim();

  return value === undefined || value === '' ? null : value;
}

/**
 * The public slug of each product that is live *right now*, keyed by id.
 *
 * Exists so the Orders screens can link an ordered item to its product page
 * without re-deriving what "live" means. `publishedScope()` is six conditions
 * across two tables, and a second copy of it in another module is how a link
 * ends up offered for a product the storefront will 404 — the same "one rule,
 * two homes" failure this repository keeps finding. Callers get a slug only
 * when this module would serve the product, or nothing.
 *
 * Deliberately id-keyed and not slug-keyed: an order line stores the product
 * id, and the *frozen* slug on its snapshot is what the buyer saw rather than
 * what resolves today. A product that has since been re-slugged should still
 * link somewhere that works.
 */
export async function listPublishedSlugsForProducts(
  productIds: readonly string[],
  executor: DbExecutor = getDb(),
): Promise<Map<string, string>> {
  if (productIds.length === 0) return new Map();

  const rows = await listBase(executor)
    .where(and(publishedScope(), inArray(products.id, [...productIds])))
    .groupBy(products.id);

  return new Map(
    rows
      .filter((row): row is typeof row & { slug: string } => row.slug !== null)
      .map((row) => [row.id, row.slug]),
  );
}

export async function findPublishedProductBySlug(
  slug: string,
  executor: DbExecutor = getDb(),
): Promise<StorefrontDetailRow | null> {
  const rows = await listBase(executor)
    .where(and(publishedScope(), eq(products.slug, slug)))
    .groupBy(products.id)
    .limit(1);
  const base = rows[0] === undefined ? null : toListRow(rows[0]);

  if (base === null) return null;

  const [
    images,
    description,
    variants,
    specs,
    specification,
    metaDescription,
    rating,
  ] = await Promise.all([
    loadApprovedImages(executor, base.id),
    loadDescriptionBlocks(executor, base.id),
    loadPublishedVariants(executor, base.id),
    loadSpecs(executor, base.id),
    loadSpecification(executor, base.id),
    loadMetaDescription(executor, base.id),
    loadRatingSummary(executor, base.id),
  ]);

  return {
    ...base,
    images,
    // Every one of these is omitted rather than defaulted when its rows do not
    // exist. An empty `description` key would tell the consumer a description
    // exists and is blank; absent says nobody has written one.
    ...(description === null ? {} : { description }),
    ...(variants.length === 0 ? {} : { variants }),
    ...(specs === null ? {} : { specs }),
    ...(specification.length === 0 ? {} : { specification }),
    ...(metaDescription === null ? {} : { metaDescription }),
    ...(rating === undefined ? {} : { rating }),
  };
}

/**
 * Every main (L1) department in the taxonomy, published or not.
 *
 * This is the storefront's "All departments" list — the full shape of the
 * catalogue, which a buyer is entitled to see even where nothing is stocked
 * yet. It reads the taxonomy table directly and joins nothing, so a
 * department with no live product still appears; `listPublishedCategories`
 * below is the stock-backed list, and the two are deliberately different
 * answers to different questions.
 *
 * Scoped to `SALS3_TAXONOMY_DEPARTMENTS` because the table also holds
 * auto-mirrored CJ rows whose `l1` is a whole supplier path — see that
 * constant for why no filter on the rows themselves separates them.
 */
export async function listCategoryDepartments(
  executor: DbExecutor = getDb(),
): Promise<StorefrontDepartmentRow[]> {
  const rows = await executor
    .selectDistinct({ l1: sals3Categories.l1 })
    .from(sals3Categories)
    .where(inArray(sals3Categories.l1, [...SALS3_TAXONOMY_DEPARTMENTS]))
    .orderBy(asc(sals3Categories.l1));

  return rows.filter(
    (row): row is StorefrontDepartmentRow => row.l1 !== null && row.l1 !== '',
  );
}

/**
 * The categories that actually have something to browse.
 *
 * Derived from published products rather than from the taxonomy table, so no
 * empty category tile ever renders. A category with no live product is not a
 * navigable category.
 */
export async function listPublishedCategories(
  executor: DbExecutor = getDb(),
): Promise<StorefrontCategoryRow[]> {
  return executor
    .selectDistinct({
      code: sals3Categories.code,
      path: sals3Categories.path,
    })
    .from(products)
    .innerJoin(
      productRevisions,
      eq(productRevisions.id, products.publishedRevisionId),
    )
    .innerJoin(productVariants, eq(productVariants.productId, products.id))
    .innerJoin(productOffers, eq(productOffers.variantId, productVariants.id))
    .innerJoin(sals3Categories, eq(sals3Categories.id, products.categoryId))
    .where(and(publishedScope(), ne(sals3Categories.path, '')))
    .orderBy(asc(sals3Categories.path));
}
