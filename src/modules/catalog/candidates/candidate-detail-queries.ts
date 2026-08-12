import { and, desc, eq } from 'drizzle-orm';
import getDb from '@/lib/db/client';
import {
  candidateDiscoverySignals,
  candidateEvaluations,
  supplierCandidates,
  supplierConnections,
  supplierSnapshots,
} from '@/lib/db/schema';
import type { CandidateEvidence } from '@/lib/cj/evidence';
import {
  listProductOverridesForCandidate,
  listVariantOverridesForCandidate,
} from '@/modules/pricing/repository';
import { listProviderReferencesForSourceCandidate } from '@/modules/catalog/products/repository';
import listAuditEventsForEntity from './audit-queries';
import type { CandidateDetail } from './candidate-detail';
import { feedSnapshotSchema, type EvidenceSummary } from './rules/contracts';
import { listStockAttestations } from './stock-review-repository';

/**
 * The read behind the read-only candidate detail drawer on Product Sourcing.
 *
 * ## Authorization
 *
 * The seller filter lives in the SAME `WHERE` as the lookup, on
 * `supplierConnections.sellerAccountId` (ADR-008) - never the legacy
 * `intendedSellerId`. A missing candidate and another seller's candidate both
 * return `null`, indistinguishably, so a probe cannot tell them apart.
 *
 * `candidateBelongsToSeller` is deliberately NOT used here. It is the right
 * helper for a mutation, but in a read it would mean one boolean statement
 * followed by an unscoped fetch - two round trips, and exactly the
 * check-then-fetch shape `repository.ts` rejects. `findCandidateById`,
 * `findEvaluationByCandidateId` and `findSnapshotByCandidateId` are not composed
 * for the same reason: all three are scoped by candidate id alone, so calling
 * them from a seller-facing read would move the tenancy property into the
 * caller.
 *
 * Every child table read below is either independently seller-scoped
 * (`listStockAttestations`) or reachable only through a candidate id this
 * function has already proven. `audit_events` has no tenant column at all,
 * which is precisely why it must sit behind the gate.
 */

/** Which `entity_type` candidate audit events are written under - see `evaluate.ts` and `products/actions.ts`. */
const CANDIDATE_ENTITY_TYPE = 'supplier_candidate';

/**
 * `evidence` and `evidence_summary` have no Zod schema in this codebase, so
 * they follow the existing `asEvidence` cast convention in `queries.ts` rather
 * than gaining a second definition of a type that already exists. `feed_snapshot`
 * IS parsed, because `feedSnapshotSchema` already exists for it.
 */
function asEvidence(value: unknown): CandidateEvidence | null {
  return (value as CandidateEvidence | null) ?? null;
}

function asEvidenceSummary(value: unknown): EvidenceSummary | null {
  return (value as EvidenceSummary | null) ?? null;
}

function parseFeedSnapshot(value: unknown) {
  const parsed = feedSnapshotSchema.safeParse(value);

  return parsed.success ? parsed.data : null;
}

/**
 * The authorization gate: one statement, and the only one that runs when the
 * candidate does not belong to this seller.
 *
 * Both left joins are provably non-inflating - `candidate_evaluations` and
 * `supplier_snapshots` are each unique on `candidate_id`
 * (`candidate_evaluations_candidate_id_key`,
 * `supplier_snapshots_candidate_id_key`) - so this cannot return more than the
 * one row it limits to. Mirrors `queries.ts#baseQuery`.
 */
function gateQuery(sellerAccountId: string, candidateId: string) {
  return getDb()
    .select({
      candidate: supplierCandidates,
      connectionId: supplierConnections.id,
      connectionStatus: supplierConnections.status,
      evaluation: candidateEvaluations,
      snapshotSchemaVersion: supplierSnapshots.schemaVersion,
      snapshotChecksum: supplierSnapshots.checksum,
      snapshotCapturedAt: supplierSnapshots.capturedAt,
      snapshotEvidence: supplierSnapshots.evidence,
    })
    .from(supplierCandidates)
    .innerJoin(
      supplierConnections,
      eq(supplierConnections.id, supplierCandidates.supplierConnectionId),
    )
    .leftJoin(
      candidateEvaluations,
      eq(candidateEvaluations.candidateId, supplierCandidates.id),
    )
    .leftJoin(
      supplierSnapshots,
      eq(supplierSnapshots.candidateId, supplierCandidates.id),
    )
    .where(
      and(
        eq(supplierCandidates.id, candidateId),
        eq(supplierConnections.sellerAccountId, sellerAccountId),
      ),
    )
    .limit(1);
}

export default async function resolveCandidateDetail(
  sellerAccountId: string,
  candidateId: string,
): Promise<CandidateDetail | null> {
  const [gate] = await gateQuery(sellerAccountId, candidateId);

  // Not this seller's candidate, or no such candidate. No child query runs.
  if (gate === undefined) return null;

  const db = getDb();
  const [
    discoverySignals,
    attestations,
    productOverrides,
    variantOverrides,
    auditEvents,
    productReferences,
  ] = await Promise.all([
    db
      .select()
      .from(candidateDiscoverySignals)
      .where(eq(candidateDiscoverySignals.candidateId, candidateId))
      .orderBy(desc(candidateDiscoverySignals.lastObservedAt)),
    listStockAttestations(db, { candidateId, sellerAccountId }),
    listProductOverridesForCandidate(db, candidateId),
    listVariantOverridesForCandidate(db, candidateId),
    listAuditEventsForEntity(db, {
      entityType: CANDIDATE_ENTITY_TYPE,
      entityId: candidateId,
    }),
    listProviderReferencesForSourceCandidate(db, candidateId),
  ]);

  const evidence = asEvidence(gate.snapshotEvidence);

  return {
    candidate: gate.candidate,
    connection: { id: gate.connectionId, status: gate.connectionStatus },
    evaluation: gate.evaluation,
    feedSnapshot:
      gate.evaluation === null
        ? null
        : parseFeedSnapshot(gate.evaluation.feedSnapshot),
    evidenceSummary:
      gate.evaluation === null
        ? null
        : asEvidenceSummary(gate.evaluation.evidenceSummary),
    snapshot:
      evidence === null || gate.snapshotCapturedAt === null
        ? null
        : {
            schemaVersion: gate.snapshotSchemaVersion ?? '',
            checksum: gate.snapshotChecksum ?? '',
            capturedAt: gate.snapshotCapturedAt,
            evidence,
          },
    attestations,
    discoverySignals,
    productOverrides,
    variantOverrides,
    auditEvents,
    productReferences,
  };
}
