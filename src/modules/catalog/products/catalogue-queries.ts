import { and, count, desc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import getDb from '@/lib/db/client';
import {
  products,
  productVariants,
  productRevisions,
  providerProductReferences,
  supplierProviders,
} from '@/lib/db/schema';
import type { ProductPublicationState } from '@/lib/seller-center/product-catalogue/status';

/**
 * Read model for the REAL `/listings` page - the steward seller's products out
 * of the database, replacing the fixture list the page rendered before.
 *
 * Every read folds `products.steward_seller_account_id` into the SAME `WHERE`
 * as its other predicates - never a fetch-then-filter. The joins are left
 * joins because a product without a provider reference or an open revision is
 * a legal row that must still list.
 *
 * `CATALOGUE_PAGE_SIZE` is 50, not the pipeline's 100: these rows carry a
 * provider-reference join, a variant-count subquery, and a revision join, so
 * each is heavier than a lean pipeline row.
 */

export const CATALOGUE_PAGE_SIZE = 50;

export type CatalogueListingRow = {
  productId: string;
  title: string;
  publicationState: ProductPublicationState;
  createdAt: Date;
  updatedAt: Date;
  /** Null when no provider reference exists (not the case for CJ-drafted rows). */
  providerCode: string | null;
  externalProductId: string | null;
  sourceStatus: string | null;
  syncState: string | null;
  variantCount: number;
  /** The open draft revision's workflow state, when one exists. */
  revisionWorkflowState: string | null;
};

/** `%`/`_` are LIKE wildcards; a seller typing one means the literal character. */
function escapeLikePattern(term: string) {
  return term.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function scope(
  sellerAccountId: string,
  states: ProductPublicationState[],
  search: string,
) {
  const conditions = [
    eq(products.stewardSellerAccountId, sellerAccountId),
    inArray(products.publicationState, states),
  ];

  if (search !== '') {
    const pattern = `%${escapeLikePattern(search)}%`;

    conditions.push(
      or(
        ilike(products.title, pattern),
        ilike(providerProductReferences.externalProductId, pattern),
      )!,
    );
  }

  return and(...conditions);
}

export async function listCatalogueRowsForSteward(
  sellerAccountId: string,
  input: {
    states: ProductPublicationState[];
    search: string;
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
      providerCode: supplierProviders.code,
      externalProductId: providerProductReferences.externalProductId,
      sourceStatus: providerProductReferences.sourceStatus,
      syncState: providerProductReferences.syncState,
      variantCount: sql<number>`(
        select count(*)::int from ${productVariants}
        where ${productVariants.productId} = ${products.id}
      )`,
      revisionWorkflowState: productRevisions.workflowState,
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
    .leftJoin(
      productRevisions,
      eq(productRevisions.id, products.currentRevisionId),
    )
    .where(scope(sellerAccountId, input.states, input.search))
    .orderBy(desc(products.createdAt))
    .limit(Math.min(Math.max(input.limit, 1), CATALOGUE_PAGE_SIZE))
    .offset(Math.max(input.offset, 0));

  return rows;
}

/** Total behind `listCatalogueRowsForSteward` - same scope, unpaged. Joins must mirror the list so the search predicate compiles. */
export async function countCatalogueRowsForSteward(
  sellerAccountId: string,
  input: { states: ProductPublicationState[]; search: string },
): Promise<number> {
  const rows = await getDb()
    .select({ total: count() })
    .from(products)
    .leftJoin(
      providerProductReferences,
      eq(providerProductReferences.productId, products.id),
    )
    .where(scope(sellerAccountId, input.states, input.search));

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
