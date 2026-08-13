import { sals3Categories, ACTIVE_TAXONOMY_VERSION } from '@/lib/db/schema';
import type { Executor } from '@/modules/catalog/candidates/repository';

import {
  findActiveMapping,
  findCategoryByCode,
  findHighestMappingVersion,
  insertMappingProposal,
  reviewMapping,
  supersedeActiveMapping,
  type ActiveMappingWithCategory,
} from './repository';
import type { CategoryMappingResolutionInput } from './types';

/**
 * Owner decision 2026-08-14 (Bogs): the supplier's own category IS the Sals3
 * category. A product sourced from CJ is categorised by CJ's category — no
 * separate human-approved crosswalk decision is required before a listing can
 * carry a category.
 *
 * This supersedes ADR-002 §3's "no active rule without an owner approval" for
 * the specific case of a 1:1 mirror: when no reviewed rule exists for a
 * supplier category, one is created automatically that maps it to a Sals3
 * category row mirroring the supplier's category verbatim
 * (`code = CJ-<external id>`, `path` = the observed supplier name).
 *
 * What is deliberately kept from the original design:
 *
 * - **The identity is the external category id, never the name.** The mirror
 *   row is keyed to the id CJ cannot reword; the observed path is display
 *   text and provenance only.
 * - **A reviewed rule still wins.** An existing `ACTIVE` mapping that names a
 *   category is returned untouched — the mirror only fills absence, so a
 *   future owner-reviewed remap of one supplier category to a curated Sals3
 *   branch overrides the mirror for every product drafted after it.
 * - **History is versioned, not rewritten.** An active row that names no
 *   category (`AMBIGUOUS`/`UNMAPPED` decision) is superseded with a new
 *   version, exactly as a human review would, and the reason string records
 *   that the mirror did it and under which decision.
 * - **No supplier call.** Inputs are persisted discovery facts; this module
 *   still never talks to CJ.
 */

/** Names the decision in every row it writes, so an auditor can find them all. */
const MIRROR_REASON =
  'Automatic supplier-category mirror: the CJ category is the Sals3 category (owner decision 2026-08-14).';

function mirrorCategoryCode(externalCategoryId: string): string {
  return `CJ-${externalCategoryId}`;
}

/**
 * Get-or-create the mirror `sals3_categories` row for one supplier category.
 * Insert-and-reread on the `sals3_categories_code_key` unique index, so a
 * concurrent creator wins cleanly and the loser reads the winner's row.
 */
async function ensureMirrorCategoryRow(
  executor: Executor,
  externalCategoryId: string,
  observedCategoryPath: string | null,
) {
  const code = mirrorCategoryCode(externalCategoryId);
  const existing = await findCategoryByCode(executor, code);

  if (existing !== null) return existing;

  const path =
    observedCategoryPath !== null && observedCategoryPath.trim() !== ''
      ? observedCategoryPath.trim()
      : `CJ category ${externalCategoryId}`;

  const inserted = await executor
    .insert(sals3Categories)
    .values({ code, path, l1: path })
    .onConflictDoNothing({ target: sals3Categories.code })
    .returning();

  return inserted[0] ?? findCategoryByCode(executor, code);
}

/**
 * Returns the active mapping-with-category for a supplier category, creating
 * the mirror when none exists. `null` means there is genuinely nothing to
 * mirror (no external category id) or a concurrent writer holds the identity
 * — in both cases the caller keeps its existing "not mapped" behaviour.
 */
// eslint-disable-next-line import/prefer-default-export -- named on purpose, matching the module's other single-verb entry points.
export async function ensureCjCategoryMirror(
  executor: Executor,
  input: {
    provider: CategoryMappingResolutionInput['provider'];
    externalCategoryId: string | null;
    observedCategoryPath: string | null;
    actorId: string;
  },
): Promise<ActiveMappingWithCategory | null> {
  const externalCategoryId = input.externalCategoryId?.trim() ?? '';

  if (externalCategoryId === '') return null;

  const active = await findActiveMapping(
    executor,
    input.provider,
    externalCategoryId,
  );

  // A rule that names a category is a decision in force — reviewed or
  // mirrored, it wins and the mirror never overwrites it.
  if (active !== null && active.category !== null) return active;

  const category = await ensureMirrorCategoryRow(
    executor,
    externalCategoryId,
    input.observedCategoryPath,
  );

  if (category === null || category === undefined) return null;

  // An active AMBIGUOUS/UNMAPPED decision must be versioned out, not
  // deleted: compare-and-set on the version read above, so a concurrent
  // reviewer racing this mirror leaves exactly one winner.
  if (active !== null) {
    const superseded = await supersedeActiveMapping(executor, {
      provider: input.provider,
      externalCategoryId,
      expectedMappingVersion: active.mapping.mappingVersion,
    });

    if (superseded === null) return null;
  }

  const nextVersion =
    (await findHighestMappingVersion(
      executor,
      input.provider,
      externalCategoryId,
    )) + 1;

  const proposal = await insertMappingProposal(executor, {
    provider: input.provider,
    externalCategoryId,
    observedCategoryPath: input.observedCategoryPath,
    sals3CategoryId: category.id,
    taxonomyVersion: ACTIVE_TAXONOMY_VERSION,
    mappingVersion: nextVersion,
    supersedesId: active?.mapping.id ?? null,
    method: 'EXTERNAL_ID_RULE',
    confidence: 'EXACT',
    reason: MIRROR_REASON,
    evidenceReference: null,
    actorId: input.actorId,
  });

  // A lost version race: the winner's row is not visible from this
  // transaction, so the honest answer is "not mapped this time".
  if (proposal === null) return null;

  const activated = await reviewMapping(executor, {
    mappingId: proposal.id,
    expectedStatus: 'PROPOSED',
    expectedMappingVersion: nextVersion,
    nextReviewStatus: 'APPROVED',
    nextStatus: 'ACTIVE',
    reason: MIRROR_REASON,
    reviewedBy: input.actorId,
  });

  if (activated === null) return null;

  return { mapping: activated, category };
}
