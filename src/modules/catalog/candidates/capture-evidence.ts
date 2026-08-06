import { createHash } from 'crypto';
import db from '@/lib/db/client';
import type { CandidateEvidence } from '@/lib/cj/evidence';
import fetchCandidateEvidence from '@/services/cj/enrichment';
import { appendAuditEvent, upsertSnapshot } from './repository';

/**
 * Captures fresh CJ evidence for a shortlisted candidate and stores it as a
 * snapshot (spec sections 8.3 and 5.2).
 *
 * Deliberately **not** part of the shortlist transaction. The three CJ calls
 * take roughly 2.5 seconds because CJ allows one request per second, and
 * holding a Postgres transaction open across a third-party round trip pins a
 * connection and its locks for that whole time. Shortlisting commits first;
 * evidence is a separate, retryable write.
 *
 * A failure here does not undo the shortlist. The candidate stays shortlisted
 * with no evidence, which is the truthful outcome — better than rolling back a
 * decision the employee did make because a supplier API was briefly down.
 */

/** Bump when `CandidateEvidence`'s shape changes, so old rows stay readable. */
export const EVIDENCE_SCHEMA_VERSION = 'cj-evidence-v1';

export type CaptureEvidenceOutcome =
  | { status: 'captured'; evidence: CandidateEvidence }
  | { status: 'unavailable' };

/** SHA-256 over the normalised evidence, for cheap changed/unchanged checks. */
function checksumOf(evidence: CandidateEvidence): string {
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}

export default async function captureCandidateEvidence(input: {
  candidateId: string;
  externalProductId: string;
  actorId: string;
}): Promise<CaptureEvidenceOutcome> {
  let evidence: CandidateEvidence;

  try {
    evidence = await fetchCandidateEvidence(input.externalProductId);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] candidate evidence fetch failed', {
      externalProductId: input.externalProductId,
      reason: error instanceof Error ? error.message : 'unknown',
    });
    return { status: 'unavailable' };
  }

  const capturedAt = new Date(evidence.capturedAt);
  const checksum = checksumOf(evidence);

  await db.transaction(async (tx) => {
    await upsertSnapshot(tx, {
      candidateId: input.candidateId,
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      checksum,
      evidence,
      capturedAt,
    });

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: 'CANDIDATE_EVIDENCE_CAPTURED',
      entityType: 'supplier_candidate',
      entityId: input.candidateId,
      payload: {
        checksum,
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        variantCount: evidence.variants.length,
        usableImageCount: evidence.usableImageCount,
      },
    });
  });

  return { status: 'captured', evidence };
}
