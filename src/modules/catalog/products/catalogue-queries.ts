import {
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  ilike,
  inArray,
  sql,
} from 'drizzle-orm';
import getDb from '@/lib/db/client';
import {
  products,
  productVariants,
  productRevisions,
  providerProductReferences,
  sals3Categories,
  supplierCandidates,
  supplierConnections,
  supplierProviders,
} from '@/lib/db/schema';
import type {
  ListingsSearchField,
  ListingsSort,
} from '@/lib/portal/listings-params';
import type { ProductPublicationState } from '@/lib/seller-center/product-catalogue/status';
import type { SupplierConnectionHealth } from '@/lib/seller-center/product-catalogue/types';

/**
 * Read model for the REAL `/listings` page - the steward seller's products out
 * of the database, replacing the fixture list the page rendered before.
 *
 * Every read folds `products.steward_seller_account_id` into the SAME `WHERE`
 * as its other predicates - never a fetch-then-filter. The joins are left
 * joins because a product without a provider reference, a mapped category, or
 * an open revision is a legal row that must still list.
 *
 * ## Connection health comes from provenance, in this same statement
 *
 * `provider_product_references` deliberately carries no connection id - the row
 * is global while a connection is tenant-scoped. The honest link is
 * `source_candidate_id`: the candidate this product was drafted from, which is
 * connection-scoped by definition. So "which supplier connection is behind this
 * product" is answered by provenance, in one left-join chain, rather than by the
 * offer-scoped worst-of-N this page first considered - which would also have
 * returned nothing, because offers are only written when the seller has an
 * active market profile and none does yet.
 *
 * `CATALOGUE_PAGE_SIZE` is 25, not the pipeline's 100: each row carries a
 * provider join, a category join, a revision join, a variant-count subquery,
 * and its full variant list in the RSC payload.
 */

export const CATALOGUE_PAGE_SIZE = 25;

export type CatalogueListingRow = {
  productId: string;
  title: string;
  publicationState: ProductPublicationState;
  createdAt: Date;
  updatedAt: Date;
  /** Optimistic-concurrency token for Archive; never rendered. */
  version: number;
  /** Null until an approved mapping assigns one - the common case today. */
  categoryPath: string | null;
  brandName: string | null;
  /** Null when no provider reference exists (not the case for CJ-drafted rows). */
  providerCode: string | null;
  providerDisplayName: string | null;
  externalProductId: string | null;
  sourceStatus: string | null;
  syncState: string | null;
  /** When the supplier evidence behind this row was captured - never "now". */
  lastObservedAt: Date | null;
  variantCount: number;
  /** The open draft revision's workflow state, when one exists. */
  revisionWorkflowState: string | null;
  /** Health of the connection this product was drafted from, via provenance. */
  connectionStatus: SupplierConnectionHealth | null;
};

export type CatalogueFilterInput = {
  states: ProductPublicationState[];
  search: string;
  searchField: ListingsSearchField;
  /** `sals3_categories.id`, not a path - filtering must not need the join. */
  categoryId: string | null;
  providerCode: string | null;
};

/** `%`/`_` are LIKE wildcards; a seller typing one means the literal character. */
function escapeLikePattern(term: string) {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

/**
 * A Sals3 SKU lives on a child row, so it is matched with `EXISTS` rather than
 * a join: a join would emit one product row per matching variant and silently
 * inflate both the page and its total.
 */
function skuMatches(pattern: string) {
  return exists(
    getDb()
      .select({ one: sql`1` })
      .from(productVariants)
      .where(
        and(
          eq(productVariants.productId, products.id),
          ilike(productVariants.sals3Sku, pattern),
        ),
      ),
  );
}

function searchCondition(search: string, field: ListingsSearchField) {
  const pattern = `%${escapeLikePattern(search)}%`;

  if (field === 'SALS3_PRODUCT_ID')
    return sql`${products.id}::text ilike ${pattern}`;
  if (field === 'SELLER_SKU') return skuMatches(pattern);
  if (field === 'SUPPLIER_REFERENCE')
    return ilike(providerProductReferences.externalProductId, pattern);

  return ilike(products.title, pattern);
}

/**
 * The one place the page's predicates live. The list and the count both call
 * it, which is what makes "the total belongs to the rows shown" structurally
 * true rather than a convention two functions have to remember.
 */
function scope(sellerAccountId: string, input: CatalogueFilterInput) {
  const conditions = [
    eq(products.stewardSellerAccountId, sellerAccountId),
    inArray(products.publicationState, input.states),
  ];

  if (input.search !== '')
    conditions.push(searchCondition(input.search, input.searchField));

  if (input.categoryId !== null)
    conditions.push(eq(products.categoryId, input.categoryId));

  if (input.providerCode !== null)
    conditions.push(eq(supplierProviders.code, input.providerCode));

  return and(...conditions);
}

const ORDER_BY: Record<ListingsSort, ReturnType<typeof desc>> = {
  CREATED_DESC: desc(products.createdAt),
  CREATED_ASC: asc(products.createdAt),
  TITLE_ASC: asc(products.title),
  UPDATED_DESC: desc(products.updatedAt),
};

export async function listCatalogueRowsForSteward(
  sellerAccountId: string,
  input: CatalogueFilterInput & {
    sort: ListingsSort;
    limit: number;
    offset: number;
  },
): Promise<CatalogueListingRow[]> {
  const rows = await getDb()
    .select({
      productId: products.id,
      title: products.title,
      publicationState: products.publicationState,
      createdAt: products.createdAt,
      updatedAt: products.updatedAt,
      version: products.version,
      categoryPath: sals3Categories.path,
      brandName: products.brandName,
      providerCode: supplierProviders.code,
      providerDisplayName: supplierProviders.displayName,
      externalProductId: providerProductReferences.externalProductId,
      sourceStatus: providerProductReferences.sourceStatus,
      syncState: providerProductReferences.syncState,
      lastObservedAt: providerProductReferences.lastObservedAt,
      variantCount: sql<number>`(
        select count(*)::int from ${productVariants}
        where ${productVariants.productId} = ${products.id}
      )`,
      revisionWorkflowState: productRevisions.workflowState,
      connectionStatus: supplierConnections.status,
    })
    .from(products)
    .leftJoin(
      providerProductReferences,
      eq(providerProductReferences.productId, products.id),
    )
    .leftJoin(
      supplierProviders,
      eq(supplierProviders.id, providerProductReferences.supplierProviderId),
    )
    .leftJoin(sals3Categories, eq(sals3Categories.id, products.categoryId))
    .leftJoin(
      productRevisions,
      eq(productRevisions.id, products.currentRevisionId),
    )
    // Provenance only, and scoped: a candidate belongs to one connection, and
    // that connection must belong to this same seller before its health is
    // shown next to this seller's product.
    .leftJoin(
      supplierCandidates,
      eq(supplierCandidates.id, providerProductReferences.sourceCandidateId),
    )
    .leftJoin(
      supplierConnections,
      and(
        eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
        eq(supplierConnections.sellerAccountId, sellerAccountId),
      ),
    )
    .where(scope(sellerAccountId, input))
    .orderBy(ORDER_BY[input.sort])
    .limit(Math.min(Math.max(input.limit, 1), CATALOGUE_PAGE_SIZE))
    .offset(Math.max(input.offset, 0));

  return rows;
}

/**
 * Total behind `listCatalogueRowsForSteward` - same scope, unpaged. The
 * provider joins mirror the list because `scope()` may reference them.
 */
export async function countCatalogueRowsForSteward(
  sellerAccountId: string,
  input: CatalogueFilterInput,
): Promise<number> {
  const rows = await getDb()
    .select({ total: count() })
    .from(products)
    .leftJoin(
      providerProductReferences,
      eq(providerProductReferences.productId, products.id),
    )
    .leftJoin(
      supplierProviders,
      eq(supplierProviders.id, providerProductReferences.supplierProviderId),
    )
    .where(scope(sellerAccountId, input));

  return rows[0]?.total ?? 0;
}

/** Unfiltered per-state totals for the status tabs - never search-narrowed, matching the pipeline's tab-badge rule. */
export async function countCatalogueByPublicationState(
  sellerAccountId: string,
): Promise<Record<ProductPublicationState, number>> {
  const rows = await getDb()
    .select({ state: products.publicationState, total: count() })
    .from(products)
    .where(eq(products.stewardSellerAccountId, sellerAccountId))
    .groupBy(products.publicationState);

  const totals: Record<ProductPublicationState, number> = {
    UNPUBLISHED: 0,
    PUBLISHED: 0,
    PAUSED: 0,
    ARCHIVED: 0,
  };

  rows.forEach((row) => {
    totals[row.state] = row.total;
  });

  return totals;
}

export type CatalogueFacets = {
  categories: Array<{ id: string; path: string }>;
  providers: Array<{ code: string; displayName: string }>;
};

/**
 * The values the Category and Supplier dropdowns may offer - derived from this
 * seller's own products, so neither list ever advertises a filter that would
 * return nothing. Unfiltered by status for the same reason the tabs are.
 */
export async function listCatalogueFacets(
  sellerAccountId: string,
): Promise<CatalogueFacets> {
  const db = getDb();
  const [categories, providers] = await Promise.all([
    db
      .selectDistinct({ id: sals3Categories.id, path: sals3Categories.path })
      .from(products)
      .innerJoin(sals3Categories, eq(sals3Categories.id, products.categoryId))
      .where(eq(products.stewardSellerAccountId, sellerAccountId))
      .orderBy(asc(sals3Categories.path)),
    db
      .selectDistinct({
        code: supplierProviders.code,
        displayName: supplierProviders.displayName,
      })
      .from(products)
      .innerJoin(
        providerProductReferences,
        eq(providerProductReferences.productId, products.id),
      )
      .innerJoin(
        supplierProviders,
        eq(supplierProviders.id, providerProductReferences.supplierProviderId),
      )
      .where(eq(products.stewardSellerAccountId, sellerAccountId))
      .orderBy(asc(supplierProviders.code)),
  ]);

  return { categories, providers };
}
