import type { Database, DbTransaction } from '@/lib/db/client';
import { appendAuditEvent } from '@/modules/catalog/candidates/repository';
import type { ProviderCategoryMappingRow } from '@/lib/db/schema';

import {
  proposeCategoryMappingSchema,
  reviewCategoryMappingSchema,
  type ProposeCategoryMappingInput,
  type ReviewCategoryMappingInput,
} from './contracts';
import {
  findActiveMapping,
  findCategoryByCode,
  findHighestMappingVersion,
  findMappingById,
  findMappingByVersion,
  insertMappingProposal,
  insertRemapReviewSummary,
  reviewMapping,
  supersedeActiveMapping,
} from './repository';

/**
 * Server-only application operations for category-mapping governance.
 *
 * Called from `src/app/(portal)/listings/category-mapping-actions.ts` (owner
 * decision 2026-08-15, reversing this module's original Admin-Portal-only
 * assignment — see `authorization.ts`). Every caller must pass
 * `authorizeCategoryGovernance()` first; `boundaries.test.ts` proves the
 * import is scoped to that one authorized action and nowhere else.
 *
 * Each operation opens its own transaction so authorization state, the write,
 * the remap findings, and the audit rows commit or roll back together. Every
 * mutation is a compare-and-set on the exact version the caller read, and
 * every result is a discriminated outcome rather than a thrown error, so a
 * stale write is an answer the caller must handle rather than a 500.
 */

/**
 * Records that a correction superseded an active mapping and its effect needs
 * review.
 *
 * Deliberately one summary row, not a per-candidate list. Naming the affected
 * candidates needs a stable provider category id persisted on
 * `supplier_candidates`, which this branch does not have — the only
 * category-shaped fact available is a display *name* on the evaluation's feed
 * snapshot, and selecting rows by a supplier's category name is precisely
 * what the rest of this module refuses to do. Writing a summary that says
 * "recorded, not enumerated" is honest; writing a name-matched list would be
 * a guess wearing the clothes of an audit record.
 *
 * There is no worker behind it either. The only durable job/outbox pattern in
 * this repository belongs to the concurrent discovery work, and reaching into
 * it from here would couple two independent tasks.
 */
async function raiseRemapReview(
  tx: DbTransaction,
  input: {
    previous: ProviderCategoryMappingRow;
    next: ProviderCategoryMappingRow;
    reason: string;
    actorId: string;
  },
): Promise<RemapReviewSummary> {
  const raised = await insertRemapReviewSummary(tx, {
    provider: input.previous.provider,
    externalCategoryId: input.previous.externalCategoryId,
    previousMappingId: input.previous.id,
    previousMappingVersion: input.previous.mappingVersion,
    newMappingId: input.next.id,
    newMappingVersion: input.next.mappingVersion,
    reason: input.reason,
    actorId: input.actorId,
  });

  return {
    // `null` from the repository means the unique index already held a row for
    // this superseded mapping — a replayed correction, not a failure.
    recorded: raised !== null,
    findingId: raised?.id ?? null,
    affectedCandidatesEnumerated: false,
  };
}

export type ProposeCategoryMappingResult =
  | { outcome: 'PROPOSED'; mapping: ProviderCategoryMappingRow }
  /** The exact version already exists — a retry of the same proposal, not a second one. */
  | { outcome: 'ALREADY_PROPOSED'; mapping: ProviderCategoryMappingRow }
  | { outcome: 'STALE_WRITE_REJECTED'; currentVersion: number }
  | {
      outcome: 'INVALID';
      reason: 'VALIDATION_FAILED' | 'SALS3_CATEGORY_NOT_FOUND';
    };

/**
 * Records a proposed mapping. Never activates it: a proposal is inert until a
 * separate review decision, so no single call can both invent a rule and put
 * it in force.
 */
export async function proposeCategoryMapping(
  db: Database,
  raw: ProposeCategoryMappingInput,
): Promise<ProposeCategoryMappingResult> {
  const parsed = proposeCategoryMappingSchema.safeParse(raw);

  if (!parsed.success) {
    return { outcome: 'INVALID', reason: 'VALIDATION_FAILED' };
  }

  const input = parsed.data;

  return db.transaction(async (tx): Promise<ProposeCategoryMappingResult> => {
    let sals3CategoryId: string | null = null;

    if (input.sals3CategoryCode !== null) {
      const category = await findCategoryByCode(tx, input.sals3CategoryCode);

      // A code that is not in Sals3 Taxonomy v0 is rejected outright. It is
      // never created, and never downgraded to an "ambiguous" rule that would
      // then look like a considered decision.
      if (category === null) {
        return { outcome: 'INVALID', reason: 'SALS3_CATEGORY_NOT_FOUND' };
      }

      sals3CategoryId = category.id;
    }

    const currentVersion = await findHighestMappingVersion(
      tx,
      input.provider,
      input.externalCategoryId,
    );

    if (currentVersion !== input.expectedCurrentVersion) {
      return { outcome: 'STALE_WRITE_REJECTED', currentVersion };
    }

    const active = await findActiveMapping(
      tx,
      input.provider,
      input.externalCategoryId,
    );

    const nextVersion = currentVersion + 1;

    const inserted = await insertMappingProposal(tx, {
      provider: input.provider,
      externalCategoryId: input.externalCategoryId,
      observedCategoryPath: input.observedCategoryPath,
      sals3CategoryId,
      taxonomyVersion: input.taxonomyVersion,
      mappingVersion: nextVersion,
      supersedesId: active?.mapping.id ?? null,
      method: input.method,
      confidence: input.confidence,
      reason: input.reason,
      evidenceReference: input.evidenceReference,
      actorId: input.actorId,
    });

    if (inserted === null) {
      // Lost the race on the version unique index. Re-read rather than retry:
      // the existing row IS the outcome of this idempotent request.
      const existing = await findMappingByVersion(
        tx,
        input.provider,
        input.externalCategoryId,
        nextVersion,
      );

      return existing === null
        ? { outcome: 'STALE_WRITE_REJECTED', currentVersion: nextVersion }
        : { outcome: 'ALREADY_PROPOSED', mapping: existing };
    }

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: 'category_mapping.proposed',
      entityType: 'provider_category_mapping',
      entityId: inserted.id,
      payload: {
        provider: inserted.provider,
        externalCategoryId: inserted.externalCategoryId,
        mappingVersion: inserted.mappingVersion,
        method: inserted.method,
        confidence: inserted.confidence,
        taxonomyVersion: inserted.taxonomyVersion,
        sals3CategoryCode: input.sals3CategoryCode,
        supersedesId: inserted.supersedesId,
        reason: inserted.reason,
        evidenceReference: inserted.evidenceReference,
      },
    });

    return { outcome: 'PROPOSED', mapping: inserted };
  });
}

export type RemapReviewSummary = {
  /** False when an identical correction had already raised this review. */
  recorded: boolean;
  findingId: string | null;
  /**
   * Always `false` on this branch. It is a statement that the blast radius is
   * recorded but not listed — never "nothing was affected". See
   * `raiseRemapReview`.
   */
  affectedCandidatesEnumerated: false;
};

export type ReviewCategoryMappingResult =
  | {
      outcome: 'ACTIVATED';
      mapping: ProviderCategoryMappingRow;
      supersededMappingId: string | null;
      remapReview: RemapReviewSummary | null;
    }
  | { outcome: 'REJECTED'; mapping: ProviderCategoryMappingRow }
  /** Not found, not in the expected state, or already reviewed by someone else — one indistinguishable answer. */
  | { outcome: 'STALE_WRITE_REJECTED' }
  | { outcome: 'INVALID'; reason: 'VALIDATION_FAILED' };

/**
 * Approves-and-activates, or rejects, one proposed mapping.
 *
 * Activation supersedes the previous active row inside the same transaction
 * and, when one existed, raises review findings for the candidates whose
 * persisted provider category the correction changed the meaning of. It does
 * not rewrite a single historical row: no candidate, evaluation, snapshot, or
 * audit event is updated, and no product is republished, repriced, blocked,
 * or approved as a consequence of a mapping decision.
 */
export async function reviewCategoryMappingDecision(
  db: Database,
  raw: ReviewCategoryMappingInput,
): Promise<ReviewCategoryMappingResult> {
  const parsed = reviewCategoryMappingSchema.safeParse(raw);

  if (!parsed.success) {
    return { outcome: 'INVALID', reason: 'VALIDATION_FAILED' };
  }

  const input = parsed.data;

  return db.transaction(async (tx): Promise<ReviewCategoryMappingResult> => {
    const proposal = await findMappingById(tx, input.mappingId);

    if (
      proposal === null ||
      proposal.status !== 'PROPOSED' ||
      proposal.mappingVersion !== input.expectedMappingVersion
    ) {
      return { outcome: 'STALE_WRITE_REJECTED' };
    }

    if (input.decision === 'REJECT') {
      const rejected = await reviewMapping(tx, {
        mappingId: proposal.id,
        expectedStatus: 'PROPOSED',
        expectedMappingVersion: input.expectedMappingVersion,
        nextReviewStatus: 'REJECTED',
        nextStatus: 'REJECTED',
        reason: input.reason,
        reviewedBy: input.reviewedBy,
      });

      if (rejected === null) return { outcome: 'STALE_WRITE_REJECTED' };

      await appendAuditEvent(tx, {
        actorId: input.reviewedBy,
        action: 'category_mapping.rejected',
        entityType: 'provider_category_mapping',
        entityId: rejected.id,
        payload: {
          provider: rejected.provider,
          externalCategoryId: rejected.externalCategoryId,
          mappingVersion: rejected.mappingVersion,
          reason: rejected.reason,
        },
      });

      return { outcome: 'REJECTED', mapping: rejected };
    }

    const previous = await findActiveMapping(
      tx,
      proposal.provider,
      proposal.externalCategoryId,
    );

    if (previous !== null) {
      const superseded = await supersedeActiveMapping(tx, {
        provider: proposal.provider,
        externalCategoryId: proposal.externalCategoryId,
        expectedMappingVersion: previous.mapping.mappingVersion,
      });

      // Someone else superseded it between the read and the write. Roll back
      // rather than activate on top of a predecessor that already moved.
      if (superseded === null) return { outcome: 'STALE_WRITE_REJECTED' };
    }

    const activated = await reviewMapping(tx, {
      mappingId: proposal.id,
      expectedStatus: 'PROPOSED',
      expectedMappingVersion: input.expectedMappingVersion,
      nextReviewStatus: 'APPROVED',
      nextStatus: 'ACTIVE',
      reason: input.reason,
      reviewedBy: input.reviewedBy,
    });

    if (activated === null) return { outcome: 'STALE_WRITE_REJECTED' };

    const remapReview =
      previous === null
        ? null
        : await raiseRemapReview(tx, {
            previous: previous.mapping,
            next: activated,
            reason: input.reason,
            actorId: input.reviewedBy,
          });

    await appendAuditEvent(tx, {
      actorId: input.reviewedBy,
      action: 'category_mapping.activated',
      entityType: 'provider_category_mapping',
      entityId: activated.id,
      payload: {
        provider: activated.provider,
        externalCategoryId: activated.externalCategoryId,
        mappingVersion: activated.mappingVersion,
        confidence: activated.confidence,
        method: activated.method,
        taxonomyVersion: activated.taxonomyVersion,
        supersededMappingId: previous?.mapping.id ?? null,
        supersededMappingVersion: previous?.mapping.mappingVersion ?? null,
        reason: activated.reason,
        remapReviewRaised: remapReview?.recorded ?? false,
        remapReviewFindingId: remapReview?.findingId ?? null,
        remapAffectedCandidatesEnumerated: false,
      },
    });

    return {
      outcome: 'ACTIVATED',
      mapping: activated,
      supersededMappingId: previous?.mapping.id ?? null,
      remapReview,
    };
  });
}
