import getDb from '@/lib/db/client';
import { CjApiError } from '@/services/cj/config';
import fetchCandidateEvidence from '@/services/cj/enrichment';
import { checksumOfEvidence } from '@/lib/cj/evidence';
import type { CandidateEvaluationRow } from '@/lib/db/schema';
import { decide } from './rules/decide';
import { feedSnapshotSchema } from './rules/contracts';
import {
  EVIDENCE_SCHEMA_VERSION,
  MAX_EVALUATION_ATTEMPTS,
  nextRetryDelayMs,
  POLICY_VERSION,
} from './rules/policy';
import { runQualification, summariseEvidence } from './rules/qualification';
import { runScreening } from './rules/screening';
import {
  appendAuditEvent,
  findCandidateById,
  recordEvaluationDecision,
  recordEvaluationFailure,
  recordScreeningDecision,
  upsertSnapshot,
} from './repository';

/**
 * Evaluates one leased candidate: cheap screening first (spec's "cheap
 * automatic screening" step, using only the feed data captured at
 * ingestion), then - for survivors - the existing CJ evidence fetch and the
 * full qualification rules. Every CJ call happens outside a transaction,
 * matching the discipline already established in `capture-evidence.ts`; only
 * the final persistence step is a short transaction.
 */
export default async function evaluateCandidate(
  row: CandidateEvaluationRow,
): Promise<void> {
  const candidate = await findCandidateById(getDb(), row.candidateId);

  if (candidate === null) {
    // The candidate row is gone (should not happen - cascade delete would
    // remove this evaluation row too). Nothing safe to do but stop.
    return;
  }

  const feedSnapshot = feedSnapshotSchema.parse(row.feedSnapshot);
  const screeningFindings = runScreening(feedSnapshot);
  const screeningBlocked = screeningFindings.some(
    (finding) => finding.severity === 'BLOCK',
  );

  if (screeningBlocked) {
    const decision = decide(screeningFindings);

    await getDb().transaction(async (tx) => {
      await recordScreeningDecision(tx, {
        candidateId: row.candidateId,
        decision,
        policyVersion: POLICY_VERSION,
      });
      await appendAuditEvent(tx, {
        actorId: 'system:catalog-evaluator',
        action: 'CANDIDATE_SCREENING_DECIDED',
        entityType: 'supplier_candidate',
        entityId: row.candidateId,
        payload: { decision, screeningOnly: true },
      });
    });

    return;
  }

  let evidence;

  try {
    evidence = await fetchCandidateEvidence(candidate.externalProductId);
  } catch (error) {
    const reason =
      error instanceof CjApiError ? error.reason : 'unexpected-response';
    const attemptCount = row.attemptCount + 1;
    const exhausted = attemptCount >= MAX_EVALUATION_ATTEMPTS;

    // eslint-disable-next-line no-console
    console.error('[portal] automated candidate evaluation fetch failed', {
      candidateId: row.candidateId,
      externalProductId: candidate.externalProductId,
      reason,
      attemptCount,
    });

    await getDb().transaction(async (tx) => {
      await recordEvaluationFailure(tx, {
        candidateId: row.candidateId,
        attemptCount,
        lastErrorCode: reason,
        nextRetryAt: exhausted
          ? null
          : new Date(Date.now() + nextRetryDelayMs(attemptCount)),
      });
      await appendAuditEvent(tx, {
        actorId: 'system:catalog-evaluator',
        action: exhausted
          ? 'CANDIDATE_EVALUATION_DEAD_LETTERED'
          : 'CANDIDATE_EVALUATION_RETRY_SCHEDULED',
        entityType: 'supplier_candidate',
        entityId: row.candidateId,
        payload: { reason, attemptCount },
      });
    });

    return;
  }

  const qualificationFindings = runQualification(
    evidence,
    row.lastKnownPriceUsdCents,
  );
  const decision = decide([...screeningFindings, ...qualificationFindings]);
  const evidenceSummary = summariseEvidence(
    evidence,
    row.lastKnownPriceUsdCents,
  );
  const currentPriceUsdCents =
    evidence.supplierPriceUsd === null
      ? null
      : Math.round(evidence.supplierPriceUsd * 100);

  const checksum = checksumOfEvidence(evidence);

  await getDb().transaction(async (tx) => {
    await upsertSnapshot(tx, {
      candidateId: row.candidateId,
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      checksum,
      evidence,
      capturedAt: new Date(evidence.capturedAt),
    });
    await recordEvaluationDecision(tx, {
      candidateId: row.candidateId,
      decision,
      evidenceSummary,
      sourceSnapshotChecksum: checksum,
      policyVersion: POLICY_VERSION,
      lastKnownPriceUsdCents: currentPriceUsdCents,
    });
    await appendAuditEvent(tx, {
      actorId: 'system:catalog-evaluator',
      action: 'CANDIDATE_EVALUATION_DECIDED',
      entityType: 'supplier_candidate',
      entityId: row.candidateId,
      payload: { decision, checksum },
    });
  });
}
