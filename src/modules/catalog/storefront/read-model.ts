import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  sql,
} from 'drizzle-orm';
import getDb, { type DbExecutor } from '@/lib/db/client';
import type { RatingSummary } from '@/modules/reviews/contracts';
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
 * True when the product has at least one approved, renderable photo the
 * seller uploaded themselves. Correlated on `products.id`, so it works both
 * inside the card's `primaryImageUrl` subquery and joined in
 * `loadApprovedImages`.
 */
const hasApprovedSellerUpload = sql`exists (
  select 1
  from ${productMediaSources} as seller_media
  where seller_media.product_id = ${products.id}
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
 * One product's display image: the first approved media row a buyer may see
 * (`mediaVisibleToBuyers`), seller uploads before supplier originals,
 * product-level before variant-level, oldest observation first so the choice
 * is stable across requests rather than whatever the planner returns.
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
  order by ${sellerUploadsFirst},
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

async function withRatings(
  rows: StorefrontListRow[],
  executor: DbExecutor,
): Promise<StorefrontListRow[]> {
  if (rows.length === 0) return rows;

  const summaries = await safeRatingSummaries(
    rows.map((row) => row.id),
    executor,
  );

  return rows.map((row) => {
    const rating = summaries.get(row.id);

    return rating === undefined || rating.count === 0
      ? row
      : { ...row, rating };
  });
}

/**
 * One product's rating, for the detail path.
 *
 * Kept separate from `withRatings` so it can ride the detail loader's existing
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
    rows: await withRatings(
      rows
        .map(toListRow)
        .filter((row): row is StorefrontListRow => row !== null),
      executor,
    ),
    total: totals[0]?.total ?? 0,
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
 * Every approved image a buyer may see for the product — the same
 * `mediaVisibleToBuyers` gate and seller-uploads-first precedence the card's
 * single image uses, so the gallery's lead photo is the one the card showed.
 * Joins `products` for `show_supplier_photo`; the join cannot fan out because
 * `product_id` references one row.
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
        eq(productMediaSources.reviewState, 'APPROVED'),
        ne(productMediaSources.rightsBasis, 'UNKNOWN'),
        isNotNull(productMediaSources.sourceUrl),
        mediaVisibleToBuyers,
      ),
    )
    .orderBy(
      sellerUploadsFirst,
      sql`(${productMediaSources.variantId} is null) desc`,
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
    })
    .from(productVariants)
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

  return [...byVariant.values()].sort((left, right) =>
    compareMatrixOrder(
      orderKeys.get(left.id) ?? [],
      orderKeys.get(right.id) ?? [],
      left.sku,
      right.sku,
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
