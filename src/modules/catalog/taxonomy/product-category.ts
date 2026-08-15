import type { Database } from '@/lib/db/client';
import type { ProductRow } from '@/lib/db/schema';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import { findProductForSteward } from '@/modules/catalog/products/repository';

import { resolveCategoryMapping } from './resolver';
import {
  assignProductCategory,
  clearProductCategory,
  findCategoryByCode,
} from './repository';
import { toProductCategoryAssignment } from './integration';
import {
  isMappedDecision,
  type CategoryMappingDecision,
  type ProviderCategoryFacts,
} from './types';

/**
 * The one write path that puts a Sals3 category on a product.
 *
 * The canonical Product backend stores `category_id`,
 * `category_mapping_confidence`, and (as of this change) the mapping id and
 * version that produced them. Its own schema comment says a CJ-sourced draft
 * starts `UNMAPPED` because "no CJ-to-Sals3 taxonomy crosswalk exists". This
 * is that crosswalk, applied.
 *
 * Three properties matter more than convenience here:
 *
 * - **The category is never chosen by the caller.** This function has no
 *   category parameter. It takes supplier-category facts, asks the resolver,
 *   and writes whatever the resolver returned — including "nothing", which
 *   leaves the product `UNMAPPED` and is a normal outcome rather than a
 *   failure.
 * - **Tenancy comes from the session, never the request.** Every read and
 *   write folds `stewardSellerAccountId` into its `WHERE`, and a product
 *   belonging to another seller answers exactly like a product that does not
 *   exist.
 * - **A review outcome clears rather than keeps.** If a product was mapped
 *   under a rule that has since been superseded or downgraded, this resets it
 *   to `UNMAPPED` instead of leaving a stale category standing. Losing a
 *   category is recoverable; silently pricing and publishing against a
 *   withdrawn one is not.
 *
 * `providerCategory` must come from persisted supplier facts. It is typed,
 * not free-form, and it can only ever *select* among approved mappings — no
 * value a caller passes can invent a Sals3 category, because the resolver has
 * no branch that produces one without an active approved rule. Called from
 * `category-mapping-actions.ts` after a decision is activated, to apply it to
 * the product that was open when someone decided it; see `authorization.ts`
 * for the governance boundary that gates the caller.
 */

export type ApplyProductCategoryResult =
  | {
      outcome: 'CATEGORY_ASSIGNED';
      product: ProductRow;
      decision: CategoryMappingDecision;
    }
  /** Resolver said review. The product is left/put `UNMAPPED`, deliberately. */
  | {
      outcome: 'CATEGORY_REVIEW_REQUIRED';
      product: ProductRow;
      decision: CategoryMappingDecision;
    }
  /** Not found, not this tenant's, or the version moved — one indistinguishable answer. */
  | { outcome: 'NOT_FOUND' };

export async function applyResolvedCategoryToProduct(
  db: Database,
  input: {
    productId: string;
    stewardSellerAccountId: string;
    providerCategory: ProviderCategoryFacts;
    taxonomyVersion: string;
    /** Compare-and-set on `products.version`, the token the caller read. */
    expectedProductVersion: number;
    actorId: string;
  },
): Promise<ApplyProductCategoryResult> {
  return db.transaction(async (tx): Promise<ApplyProductCategoryResult> => {
    const existing = await findProductForSteward(
      tx,
      input.productId,
      input.stewardSellerAccountId,
    );

    if (
      existing === null ||
      existing.version !== input.expectedProductVersion
    ) {
      return { outcome: 'NOT_FOUND' };
    }

    const decision = await resolveCategoryMapping(tx, {
      ...input.providerCategory,
      taxonomyVersion: input.taxonomyVersion,
      // The product records the version it was last assigned under, so a
      // mapping that has moved on since is reported as superseded rather than
      // quietly re-resolved to whatever is current now.
      expectedMappingVersion: existing.categoryMappingVersion,
    });

    const assignment = toProductCategoryAssignment(decision);

    if (!isMappedDecision(decision) || assignment.categoryCode === null) {
      const cleared = await clearProductCategory(tx, {
        productId: existing.id,
        stewardSellerAccountId: input.stewardSellerAccountId,
        expectedVersion: existing.version,
        actorId: input.actorId,
      });

      if (cleared === null) return { outcome: 'NOT_FOUND' };

      await appendAuditEvent(tx, {
        actorId: input.actorId,
        action: 'product.category_review_required',
        entityType: 'product',
        entityId: existing.id,
        payload: {
          outcome: decision.outcome,
          reason: 'reason' in decision ? decision.reason : null,
          previousCategoryId: existing.categoryId,
          previousMappingId: existing.categoryMappingId,
          resolverVersion: decision.resolverVersion,
        },
      });

      return {
        outcome: 'CATEGORY_REVIEW_REQUIRED',
        product: cleared,
        decision,
      };
    }

    // The FK target, resolved from the stable code the decision carried. The
    // resolver already proved this row exists; looking it up again is what
    // keeps the code — not a uuid — the thing that travels between modules.
    const category = await findCategoryByCode(tx, assignment.categoryCode);

    if (category === null) return { outcome: 'NOT_FOUND' };

    const updated = await assignProductCategory(tx, {
      productId: existing.id,
      stewardSellerAccountId: input.stewardSellerAccountId,
      expectedVersion: existing.version,
      categoryId: category.id,
      categoryMappingConfidence: decision.confidence,
      categoryMappingId: decision.mappingId,
      categoryMappingVersion: decision.mappingVersion,
      actorId: input.actorId,
    });

    if (updated === null) return { outcome: 'NOT_FOUND' };

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: 'product.category_assigned',
      entityType: 'product',
      entityId: updated.id,
      payload: {
        categoryCode: category.code,
        categoryPath: category.path,
        confidence: decision.confidence,
        mappingId: decision.mappingId,
        mappingVersion: decision.mappingVersion,
        taxonomyVersion: decision.taxonomyVersion,
        provider: input.providerCategory.provider,
        externalCategoryId: input.providerCategory.externalCategoryId,
        previousCategoryId: existing.categoryId,
        resolverVersion: decision.resolverVersion,
      },
    });

    return { outcome: 'CATEGORY_ASSIGNED', product: updated, decision };
  });
}
