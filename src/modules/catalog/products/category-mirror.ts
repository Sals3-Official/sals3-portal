import { z } from 'zod';

import {
  appendAuditEvent,
  findEvaluationByCandidateId,
  findSnapshotByCandidateId,
  type Executor,
} from '@/modules/catalog/candidates/repository';
import { feedSnapshotSchema } from '@/modules/catalog/candidates/rules/contracts';
import { ensureCjCategoryMirror } from '@/modules/catalog/taxonomy/cj-mirror';
import { assignProductCategory } from '@/modules/catalog/taxonomy/repository';

import { PRODUCT_AUDIT_ACTIONS } from './contracts';
import { findCandidateSourceForSeller } from './repository';

/**
 * Categorises an `UNMAPPED` product from its source candidate's CJ category,
 * at the moment publication needs a category (owner decision 2026-08-14: the
 * CJ category is the Sals3 category).
 *
 * Drafts created before that decision — like every product `create-draft.ts`
 * wrote while no reviewed mapping covered its category — carry
 * `category_id = NULL`. Publication used to refuse them outright
 * (`CATEGORY_UNMAPPED`); now it first asks this function to apply the same
 * mirror a new draft would get. Persisted discovery facts only, no supplier
 * call, and the write happens inside the caller's publish transaction so a
 * later refusal rolls it back with everything else.
 *
 * Returns the assigned category facts plus the product's new version (the
 * assignment is a compare-and-set that bumps `products.version`), or `null`
 * when the candidate genuinely has no CJ category to mirror.
 */

/** Only the one evidence field this path reads, re-validated out of the DB. */
const storedEvidenceCategorySchema = z.object({
  categoryName: z.string().nullish(),
});

export type MirroredProductCategory = {
  categoryCode: string;
  categoryMappingConfidence: 'EXACT' | 'ACCEPTABLE';
  productVersion: number;
};

export async function ensureProductCjCategory(
  executor: Executor,
  input: {
    productId: string;
    stewardSellerAccountId: string;
    expectedProductVersion: number;
    candidateId: string;
    actorId: string;
  },
): Promise<MirroredProductCategory | null> {
  const source = await findCandidateSourceForSeller(
    executor,
    input.candidateId,
    input.stewardSellerAccountId,
  );

  if (source === null || source.providerCategoryId === null) return null;

  const [snapshot, evaluation] = await Promise.all([
    findSnapshotByCandidateId(executor, input.candidateId),
    findEvaluationByCandidateId(executor, input.candidateId),
  ]);

  const evidence =
    snapshot === null
      ? null
      : (storedEvidenceCategorySchema.safeParse(snapshot.evidence).data ??
        null);
  const feed =
    evaluation === null
      ? null
      : (feedSnapshotSchema.safeParse(evaluation.feedSnapshot).data ?? null);

  const mirrored = await ensureCjCategoryMirror(executor, {
    provider: 'CJ_DROPSHIPPING',
    externalCategoryId: source.providerCategoryId,
    // Evidence first: it comes from a product-detail fetch, while the feed
    // snapshot is a list-level summary — same precedence as draft creation.
    observedCategoryPath: evidence?.categoryName ?? feed?.category ?? null,
    actorId: input.actorId,
  });

  if (
    mirrored === null ||
    mirrored.category === null ||
    (mirrored.mapping.confidence !== 'EXACT' &&
      mirrored.mapping.confidence !== 'ACCEPTABLE')
  ) {
    return null;
  }

  const updated = await assignProductCategory(executor, {
    productId: input.productId,
    stewardSellerAccountId: input.stewardSellerAccountId,
    expectedVersion: input.expectedProductVersion,
    categoryId: mirrored.category.id,
    categoryMappingConfidence: mirrored.mapping.confidence,
    categoryMappingId: mirrored.mapping.id,
    categoryMappingVersion: mirrored.mapping.mappingVersion,
    actorId: input.actorId,
  });

  if (updated === null) return null;

  await appendAuditEvent(executor, {
    actorId: input.actorId,
    action: PRODUCT_AUDIT_ACTIONS.categoryAssigned,
    entityType: 'Product',
    entityId: updated.id,
    payload: {
      categoryCode: mirrored.category.code,
      categoryPath: mirrored.category.path,
      confidence: mirrored.mapping.confidence,
      mappingId: mirrored.mapping.id,
      mappingVersion: mirrored.mapping.mappingVersion,
      taxonomyVersion: mirrored.mapping.taxonomyVersion,
      externalCategoryId: source.providerCategoryId,
      assignedAtPublish: true,
    },
  });

  return {
    categoryCode: mirrored.category.code,
    categoryMappingConfidence: mirrored.mapping.confidence,
    productVersion: updated.version,
  };
}
