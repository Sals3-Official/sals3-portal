import type { Executor } from '@/modules/catalog/candidates/repository';

import { findActiveMapping } from './repository';
import {
  CATEGORY_MAPPING_RESOLVER_VERSION,
  CATEGORY_MAPPING_REVIEW_REASON_LABELS,
  type CategoryMappingDecision,
  type CategoryMappingResolutionInput,
  type CategoryMappingReviewReason,
} from './types';

/** Every non-mapped answer is built here, so no branch can accidentally attach a category to one. */
function review(
  outcome: 'AMBIGUOUS' | 'UNMAPPED' | 'MAPPING_SUPERSEDED',
  reason: CategoryMappingReviewReason,
  mappingId: string | null,
  mappingVersion: number | null,
): CategoryMappingDecision {
  return {
    outcome,
    needsReview: true,
    reason,
    reasonLabel: CATEGORY_MAPPING_REVIEW_REASON_LABELS[reason],
    mappingId,
    mappingVersion,
    resolverVersion: CATEGORY_MAPPING_RESOLVER_VERSION,
  };
}

/**
 * The single deterministic entry point for "which Sals3 category does this
 * supplier category mean?".
 *
 * Inputs are persisted provider-category facts and a taxonomy version.
 * Nothing else: no CJ request, no `observedCategoryPath` matching, no
 * caller-supplied Sals3 category code, no market, no price. A caller cannot
 * hand this function a category code and have it accepted — there is no
 * parameter for one — so the only path to a Sals3 category is an approved,
 * active mapping row.
 *
 * Every non-mapped branch returns before naming any category, with a
 * specific review reason. `AMBIGUOUS`, `UNMAPPED`, and `MAPPING_SUPERSEDED`
 * are correct answers, not failures, and none of them can be mistaken for a
 * weak mapping: the shape simply has no category field.
 */
// eslint-disable-next-line import/prefer-default-export -- named on purpose: `resolveCategoryMapping` is the vocabulary every caller uses.
export async function resolveCategoryMapping(
  executor: Executor,
  input: CategoryMappingResolutionInput,
): Promise<CategoryMappingDecision> {
  const externalCategoryId = input.externalCategoryId?.trim() ?? '';

  if (externalCategoryId === '') {
    return review('UNMAPPED', 'PROVIDER_CATEGORY_MISSING', null, null);
  }

  const found = await findActiveMapping(
    executor,
    input.provider,
    externalCategoryId,
  );

  if (found === null) {
    return review('UNMAPPED', 'NO_ACTIVE_MAPPING', null, null);
  }

  const { mapping, category } = found;

  // A caller that recorded an older version must revalidate. Checked before
  // confidence so a superseded decision is never re-served as still current,
  // even when the new active mapping happens to agree with the old one.
  if (
    input.expectedMappingVersion !== null &&
    input.expectedMappingVersion !== mapping.mappingVersion
  ) {
    return review(
      'MAPPING_SUPERSEDED',
      'MAPPING_VERSION_SUPERSEDED',
      mapping.id,
      mapping.mappingVersion,
    );
  }

  if (mapping.taxonomyVersion !== input.taxonomyVersion) {
    return review(
      'AMBIGUOUS',
      'TAXONOMY_VERSION_MISMATCH',
      mapping.id,
      mapping.mappingVersion,
    );
  }

  if (mapping.confidence === 'AMBIGUOUS') {
    return review(
      'AMBIGUOUS',
      'MAPPING_MARKED_AMBIGUOUS',
      mapping.id,
      mapping.mappingVersion,
    );
  }

  if (mapping.confidence === 'UNMAPPED') {
    return review(
      'UNMAPPED',
      'MAPPING_MARKED_UNMAPPED',
      mapping.id,
      mapping.mappingVersion,
    );
  }

  // Unreachable while `provider_category_mappings_target_matches_confidence`
  // holds. Kept because "the confidence said EXACT so the category must be
  // there" is exactly the assumption that turns a data problem into an
  // invented category.
  if (category === null) {
    return review(
      'AMBIGUOUS',
      'MAPPING_TARGET_CATEGORY_MISSING',
      mapping.id,
      mapping.mappingVersion,
    );
  }

  return {
    outcome:
      mapping.confidence === 'EXACT' ? 'MAPPED_EXACT' : 'MAPPED_ACCEPTABLE',
    needsReview: false,
    sals3CategoryCode: category.code,
    sals3CategoryPath: category.path,
    taxonomyVersion: mapping.taxonomyVersion,
    mappingId: mapping.id,
    mappingVersion: mapping.mappingVersion,
    method: mapping.method,
    confidence: mapping.confidence,
    reviewStatus: mapping.reviewStatus,
    observedCategoryPath: mapping.observedCategoryPath,
    resolverVersion: CATEGORY_MAPPING_RESOLVER_VERSION,
  };
}
