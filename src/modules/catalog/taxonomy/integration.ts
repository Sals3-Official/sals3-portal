import type { CategoryMappingConfidence } from '@/modules/pricing/types';

import { isMappedDecision, type CategoryMappingDecision } from './types';

/**
 * The only sanctioned way to carry a mapping decision into another module.
 *
 * Deliberately a typed application contract rather than a foreign key. The
 * canonical Product/Revision/Offer backend is a separate, concurrent task; it
 * owns its own `products.category_id`/`category_mapping_confidence` columns
 * and its own migration. Adding a column there, or importing its schema here,
 * would make this pilot's migration depend on unmerged work. So this module
 * hands over a plain object, and exactly one call site wires it up when that
 * table lands.
 *
 * One follow-up is deliberately left open and must not be faked here: no
 * table in this repository yet has a column for the *mapping version* a
 * category assignment was made under. `toProductCategoryAssignment` returns
 * it so the caller can persist it the moment the canonical Product schema
 * adds that additive column — until then the value is carried, reported, and
 * not silently dropped.
 */

export type ProductCategoryAssignment = {
  /** `null` for every review outcome. Never a best guess. */
  categoryCode: string | null;
  categoryPath: string | null;
  categoryMappingConfidence: CategoryMappingConfidence;
  /** Needs an additive column on the canonical `products` table; see module comment. */
  mappingId: string | null;
  mappingVersion: number | null;
  taxonomyVersion: string | null;
  /** True for every non-mapped outcome. A caller must not publish on it. */
  requiresCategoryReview: boolean;
  resolverVersion: string;
};

/**
 * Collapses the resolver's five outcomes onto ADR-002's four confidence
 * states, which is what `modules/pricing/resolver.ts` and the Product Editor
 * already speak.
 *
 * `MAPPING_SUPERSEDED` becomes `AMBIGUOUS`, not `UNMAPPED`: a superseded
 * decision means "a mapping exists but this caller's version is no longer the
 * one in force", which is a revalidation question, not an absence. Both
 * refuse to price, so the safety outcome is identical either way — the choice
 * only affects which sentence a reviewer reads.
 */
export function toProductCategoryAssignment(
  decision: CategoryMappingDecision,
): ProductCategoryAssignment {
  if (isMappedDecision(decision)) {
    return {
      categoryCode: decision.sals3CategoryCode,
      categoryPath: decision.sals3CategoryPath,
      categoryMappingConfidence: decision.confidence,
      mappingId: decision.mappingId,
      mappingVersion: decision.mappingVersion,
      taxonomyVersion: decision.taxonomyVersion,
      requiresCategoryReview: false,
      resolverVersion: decision.resolverVersion,
    };
  }

  return {
    categoryCode: null,
    categoryPath: null,
    categoryMappingConfidence:
      decision.outcome === 'UNMAPPED' ? 'UNMAPPED' : 'AMBIGUOUS',
    mappingId: decision.mappingId,
    mappingVersion: decision.mappingVersion,
    taxonomyVersion: null,
    requiresCategoryReview: true,
    resolverVersion: decision.resolverVersion,
  };
}
