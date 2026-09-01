import { unstable_noStore as noStore } from 'next/cache';
import getDb from '@/lib/db/client';
import {
  findCataloguedCandidateIds,
  findProductEditorFixtureForSeller,
  listCatalogueProductsForSeller,
} from './read-model';

/**
 * The read half of the internal product-editor API.
 *
 * ## Why these exist, and what shipping without them cost
 *
 * The first cut of this API was writes only, on the assumption that a caller
 * already knew what it wanted to write. It does not, and cannot: an
 * attribute write needs the category's own `allowedValues`, a variant-photo
 * write needs a `mediaId` and a `variantId`, and an option mapping needs the
 * supplier labels. All of that lives in the database and none of it was
 * reachable.
 *
 * So the automation kept opening a browser to *look*, and every reader it
 * wrote against a rendered page was a guess that eventually broke:
 *
 * - `/listings` began paginating at 25 rows (Portal PR #290), so a scraper
 *   comparing the header's "122 products" against the rendered rows could
 *   never agree again - and the sourcing money-guard built on it refused
 *   every run.
 * - The Ready tab's candidate id is not in the row markup at all; the only
 *   UUID there is CJ's thumbnail filename, which looks identical to one. A
 *   scraper read three confident ids and the API answered `not_found` on all
 *   three.
 * - Once a Variant Matrix is mapped the photo picker splits into one strip
 *   per axis, so a reader collecting every `photo for X` button got 12
 *   "first-axis values" on a 5-colour product.
 *
 * None of those were bugs in the Portal. They were a client inferring
 * structure from a page that had every right to change. These routes hand
 * over the same values the editor itself renders from, so there is nothing
 * left to infer.
 *
 * ## Tenancy
 *
 * Every function here takes an explicit `sellerAccountId` and every
 * underlying query folds it into the predicate that finds the row - the same
 * scoping the editor's own reads use. A caller cannot read another tenant's
 * product by naming its id: it simply is not found.
 */

/**
 * Everything the Product Editor renders for one product.
 *
 * Deliberately the *same* builder the editor page uses
 * (`findProductEditorFixtureForSeller`) rather than a leaner bespoke query.
 * A second read path would drift from the first, and the drift would be
 * invisible: the automation would be deciding against a shape the editor no
 * longer shows.
 */
export async function readProductSnapshot(input: {
  sellerAccountId: string;
  productId: string;
}) {
  noStore();

  return findProductEditorFixtureForSeller(
    input.sellerAccountId,
    input.productId,
    getDb(),
  );
}

/**
 * The seller's whole catalogue, unpaginated.
 *
 * Unpaginated on purpose, and it is the point of the route: the browser
 * `/listings` screen paginates because a person reads 25 rows at a time,
 * and a client that needs to know "is this candidate already drafted" needs
 * *all* of them. Scraping page one and comparing it to a total is what broke.
 */
export async function readCatalogue(input: { sellerAccountId: string }) {
  noStore();

  return listCatalogueProductsForSeller(input.sellerAccountId, getDb());
}

export type ReadyCandidateRow = {
  candidateId: string;
  externalProductId: string;
  productName: string;
  supplierSku: string;
  providerCategoryName: string | null;
  intendedMarketCodes: string[];
  /**
   * True when this candidate already has a product in the catalogue.
   *
   * The whole reason this field is served rather than inferred: drafting an
   * already-drafted candidate spends 10 CJ points again
   * (`captureEvidenceBeforeDraft` runs before the idempotency check), and a
   * client deciding this from a rendered status label is one Portal redesign
   * away from paying for every replay. Owner's instruction 2026-09-02: a
   * candidate whose status is "In Catalogue" is not to be taken again.
   */
  alreadyInCatalogue: boolean;
};

/**
 * Candidates that passed screening, with the already-drafted flag attached.
 *
 * `statuses` is fixed to `PASS` rather than accepted as a parameter: this
 * route exists to answer "what may I draft next", and a caller that could
 * ask for `BLOCK` would get rows it must not spend points on.
 */
export async function readReadyCandidates(input: {
  sellerAccountId: string;
  limit: number;
  offset: number;
  search?: string | undefined;
}): Promise<ReadyCandidateRow[]> {
  noStore();

  const { listCandidatesByStatus } =
    await import('@/modules/catalog/candidates/queries');

  const rows = await listCandidatesByStatus(input.sellerAccountId, ['PASS'], {
    limit: input.limit,
    offset: input.offset,
    ...(input.search === undefined ? {} : { search: input.search }),
  });

  const drafted = await findCataloguedCandidateIds(
    input.sellerAccountId,
    rows.map((row) => row.candidateId),
    getDb(),
  );

  return rows.map((row) => {
    const snapshot = row.evaluation.feedSnapshot as {
      name?: unknown;
      sku?: unknown;
    } | null;

    return {
      candidateId: row.candidateId,
      externalProductId: row.externalProductId,
      productName: typeof snapshot?.name === 'string' ? snapshot.name : '',
      supplierSku: typeof snapshot?.sku === 'string' ? snapshot.sku : '',
      providerCategoryName: row.providerCategoryName,
      intendedMarketCodes: row.intendedMarketCodes,
      alreadyInCatalogue: drafted.has(row.candidateId),
    };
  });
}
