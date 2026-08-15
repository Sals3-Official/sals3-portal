import getDb, { type Database } from '@/lib/db/client';
import { ACTIVE_TAXONOMY_VERSION } from '@/lib/db/schema';
import {
  proposeCategoryMapping,
  reviewCategoryMappingDecision,
} from '@/modules/catalog/taxonomy/governance';
import { applyResolvedCategoryToProduct } from '@/modules/catalog/taxonomy/product-category';
import { findHighestMappingVersion } from '@/modules/catalog/taxonomy/repository';
import { isMappedDecision } from '@/modules/catalog/taxonomy/types';
import {
  findCandidateSourceForSeller,
  findProductForSteward,
  findProviderProductReferenceForProduct,
} from './repository';

export type DecideProductCategoryResult =
  | {
      ok: true;
      categoryCode: string;
      categoryPath: string;
      productVersion: number;
    }
  | { ok: false; reason: 'NOT_FOUND' }
  | { ok: false; reason: 'NO_SUPPLIER_CATEGORY' }
  | { ok: false; reason: 'UNKNOWN_SALS3_CATEGORY'; detail: string }
  | { ok: false; reason: 'STALE_WRITE' };

/**
 * Decides which real Sals3 Taxonomy v1 category a CJ supplier category
 * means, and applies it to the product open when someone decided it.
 *
 * Owner decision 2026-08-15 (reversing the original ADR-014 Admin-Portal-only
 * assignment — see `taxonomy/authorization.ts`): this runs directly from the
 * product editor. Every caller (`category-mapping-actions.ts`) must pass
 * `authorizeCategoryGovernance()` first.
 *
 * **The externalCategoryId is never client-supplied.** It is derived here
 * from the product's own `provider_product_references` → source candidate,
 * the same server-side derivation `ensureProductCjCategory` already uses at
 * publish time. A crafted payload can therefore never redirect a *different*
 * CJ category's mapping while appearing to edit this product — the only
 * thing a caller supplies is which Sals3 category was picked.
 *
 * Reuses the existing, tested governance flow unmodified: propose (as a
 * human-reviewed `REVIEWED_PATH_RULE`, `EXACT` decision) then immediately
 * approve-and-activate — a seller's single pick collapses the two-step
 * propose/review machinery into one action, exactly as
 * `scripts/approve-cj-category-mapping.mts` already does for an operator.
 * Supersedes whatever was previously `ACTIVE` for that supplier category
 * rather than overwriting it (ADR-014: history is versioned, never
 * rewritten) — platform-wide, on purpose: a CJ supplier category means one
 * Sals3 category across the whole marketplace, not one per seller.
 *
 * Three separate transactions, not one — `proposeCategoryMapping`,
 * `reviewCategoryMappingDecision` and `applyResolvedCategoryToProduct` each
 * open and manage their own (they take `Database`, not an executor a caller
 * can nest inside its own transaction), matching how
 * `scripts/approve-cj-category-mapping.mts` already chains them. Each step
 * is independently compare-and-set safe; if applying the now-active decision
 * to *this* product loses a version race, the mapping decision itself still
 * stands (it is a platform fact, not scoped to one product) and the caller
 * can simply retry against the product's current version.
 */
export async function decideProductSals3Category(input: {
  productId: string;
  sellerAccountId: string;
  expectedProductVersion: number;
  sals3CategoryCode: string;
  reason: string;
  actorId: string;
  db?: Database;
}): Promise<DecideProductCategoryResult> {
  const db = input.db ?? getDb();

  const product = await findProductForSteward(
    db,
    input.productId,
    input.sellerAccountId,
  );

  if (product === null || product.version !== input.expectedProductVersion) {
    return { ok: false, reason: 'NOT_FOUND' };
  }

  const reference = await findProviderProductReferenceForProduct(
    db,
    input.productId,
  );

  if (reference === null || reference.sourceCandidateId === null) {
    return { ok: false, reason: 'NO_SUPPLIER_CATEGORY' };
  }

  const source = await findCandidateSourceForSeller(
    db,
    reference.sourceCandidateId,
    input.sellerAccountId,
  );

  if (source === null || source.providerCategoryId === null) {
    return { ok: false, reason: 'NO_SUPPLIER_CATEGORY' };
  }

  const externalCategoryId = source.providerCategoryId;

  const currentVersion = await findHighestMappingVersion(
    db,
    'CJ_DROPSHIPPING',
    externalCategoryId,
  );

  const proposed = await proposeCategoryMapping(db, {
    provider: 'CJ_DROPSHIPPING',
    externalCategoryId,
    observedCategoryPath: null,
    taxonomyVersion: ACTIVE_TAXONOMY_VERSION,
    method: 'REVIEWED_PATH_RULE',
    confidence: 'EXACT',
    sals3CategoryCode: input.sals3CategoryCode,
    reason: input.reason,
    evidenceReference: null,
    actorId: input.actorId,
    expectedCurrentVersion: currentVersion,
  });

  if (proposed.outcome === 'INVALID') {
    return proposed.reason === 'SALS3_CATEGORY_NOT_FOUND'
      ? {
          ok: false,
          reason: 'UNKNOWN_SALS3_CATEGORY',
          detail: `"${input.sals3CategoryCode}" is not a Sals3 Taxonomy v1 category code.`,
        }
      : { ok: false, reason: 'STALE_WRITE' };
  }

  if (proposed.outcome === 'STALE_WRITE_REJECTED') {
    return { ok: false, reason: 'STALE_WRITE' };
  }

  // `ALREADY_PROPOSED` replays a request that already ran; its mapping may
  // already be ACTIVE (nothing left to review) or still PROPOSED (finish
  // the review it never got).
  if (proposed.mapping.status === 'ACTIVE') {
    const applied = await applyResolvedCategoryToProduct(db, {
      productId: input.productId,
      stewardSellerAccountId: input.sellerAccountId,
      providerCategory: {
        provider: 'CJ_DROPSHIPPING',
        externalCategoryId,
        observedCategoryPath: null,
      },
      taxonomyVersion: ACTIVE_TAXONOMY_VERSION,
      expectedProductVersion: product.version,
      actorId: input.actorId,
    });

    return applied.outcome === 'CATEGORY_ASSIGNED' &&
      isMappedDecision(applied.decision)
      ? {
          ok: true,
          categoryCode: applied.decision.sals3CategoryCode,
          categoryPath: applied.decision.sals3CategoryPath,
          productVersion: applied.product.version,
        }
      : { ok: false, reason: 'STALE_WRITE' };
  }

  const reviewed = await reviewCategoryMappingDecision(db, {
    mappingId: proposed.mapping.id,
    expectedMappingVersion: proposed.mapping.mappingVersion,
    decision: 'APPROVE_AND_ACTIVATE',
    reason: input.reason,
    reviewedBy: input.actorId,
  });

  if (reviewed.outcome !== 'ACTIVATED') {
    return { ok: false, reason: 'STALE_WRITE' };
  }

  const applied = await applyResolvedCategoryToProduct(db, {
    productId: input.productId,
    stewardSellerAccountId: input.sellerAccountId,
    providerCategory: {
      provider: 'CJ_DROPSHIPPING',
      externalCategoryId,
      observedCategoryPath: null,
    },
    taxonomyVersion: ACTIVE_TAXONOMY_VERSION,
    expectedProductVersion: product.version,
    actorId: input.actorId,
  });

  if (
    applied.outcome !== 'CATEGORY_ASSIGNED' ||
    !isMappedDecision(applied.decision)
  ) {
    return { ok: false, reason: 'STALE_WRITE' };
  }

  return {
    ok: true,
    categoryCode: applied.decision.sals3CategoryCode,
    categoryPath: applied.decision.sals3CategoryPath,
    productVersion: applied.product.version,
  };
}
