import { eq } from 'drizzle-orm';
import getDb from '@/lib/db/client';
import { providerProductReferences } from '@/lib/db/schema';
import { checksumOfEvidence } from '@/lib/cj/evidence';
import { CjApiError } from '@/services/cj/config';
import type { SupplierProviderAdapter } from '@/modules/suppliers/contracts';
import { findCandidateSourceForSeller } from '@/modules/catalog/products/repository';
import { appendAuditEvent, upsertSnapshot } from './repository';
import { EVIDENCE_SCHEMA_VERSION } from './rules/policy';

/**
 * Fetch one candidate's CJ evidence and persist it as its snapshot.
 *
 * ## Why this module came back
 *
 * It was emptied when `evaluateCandidate` became screening-only, and nothing
 * replaced it: `upsertSnapshot` was left with **zero callers**. The visible
 * consequence in production on 2026-08-13 was 31,274 `PASS` candidates with
 * 19 snapshots between them, and four product drafts with no variants, no
 * costs and no supplier bindings — `create-draft.ts` correctly reporting
 * `NO_PERSISTED_SUPPLIER_EVIDENCE` because there genuinely was none.
 *
 * Everything else already existed. `CjSupplierAdapter.getCandidateEvidence`
 * (detail + per-warehouse and per-variant inventory + a review sample, joined
 * by `vid`) was complete and unused; so was `upsertSnapshot`. Only the
 * orchestration between them was missing.
 *
 * ## This is the one place a supplier call is allowed near the catalogue
 *
 * Three CJ requests per candidate, spaced by the adapter's own
 * `REQUEST_SPACING_MS`. CJ points are an exhaustible budget reserved for
 * checkout and accepted-order protection (ADR-013 §5), so the caller must be
 * an explicit, rate-limited, permission-gated human action — never a page
 * render, never a loop over a table. `products/no-supplier-calls.test.ts`
 * lists this module as forbidden to the draft flow for exactly that reason:
 * reading a stored snapshot must never trigger a fetch (ADR-013 §1a).
 *
 * ## What it does not do
 *
 * It does not evaluate, score, publish, or write catalogue rows. It records
 * what CJ said, when, and under which schema version. Turning that evidence
 * into servable media is `products/media-projection.ts`'s job, and it needs a
 * rights basis first (ADR-011 §6).
 */

export type CaptureEvidenceDeps = {
  adapter: SupplierProviderAdapter;
};

export type CaptureEvidenceResult =
  | {
      ok: true;
      checksum: string;
      capturedAt: Date;
      variantCount: number;
      imageCount: number;
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'connection_unhealthy'
        | 'supplier_unavailable'
        | 'rate_limited';
    };

/** Connection states ingestion already treats as workable (ADR-010 §12.7). */
const WORKABLE_CONNECTION_STATUSES = new Set(['CONNECTED', 'DEGRADED']);

const AUDIT_ACTION = 'catalog_candidate_evidence.captured';

function toFailureReason(error: unknown): CaptureEvidenceResult {
  if (error instanceof CjApiError) {
    if (error.reason === 'rate-limited') {
      return { ok: false, reason: 'rate_limited' };
    }

    if (
      error.reason === 'authentication-failed' ||
      error.reason === 'missing-credentials'
    ) {
      return { ok: false, reason: 'connection_unhealthy' };
    }
  }

  return { ok: false, reason: 'supplier_unavailable' };
}

export default async function captureCandidateEvidence(
  deps: CaptureEvidenceDeps,
  input: { candidateId: string; sellerAccountId: string; actorId: string },
): Promise<CaptureEvidenceResult> {
  const db = getDb();
  // Tenant scope in the same `WHERE` as the lookup: a candidate belonging to
  // another seller is indistinguishable from one that does not exist, so this
  // cannot be used to spend another tenant's CJ points or enumerate their
  // pipeline.
  const source = await findCandidateSourceForSeller(
    db,
    input.candidateId,
    input.sellerAccountId,
  );

  if (source === null) return { ok: false, reason: 'not_found' };

  if (!WORKABLE_CONNECTION_STATUSES.has(source.connectionStatus)) {
    return { ok: false, reason: 'connection_unhealthy' };
  }

  let evidence;

  try {
    evidence = await deps.adapter.getCandidateEvidence(
      source.supplierConnectionId,
      source.externalProductId,
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[capture-evidence] supplier evidence read failed', error);
    return toFailureReason(error);
  }

  const checksum = checksumOfEvidence(evidence);
  const capturedAt = new Date(evidence.capturedAt);

  await db.transaction(async (tx) => {
    await upsertSnapshot(tx, {
      candidateId: input.candidateId,
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      checksum,
      evidence,
      capturedAt,
    });

    // A product already drafted from this candidate is now backed by newer
    // evidence. Recording the checksum and observation time here is what lets
    // a later reader tell "this draft was built from evidence we still hold"
    // from "this draft's evidence has since changed" — the `STALE` sync state
    // every existing reference currently sits in.
    await tx
      .update(providerProductReferences)
      .set({
        snapshotChecksum: checksum,
        lastObservedAt: capturedAt,
        lastSuccessfulSyncAt: capturedAt,
        syncState: 'HEALTHY',
        updatedAt: new Date(),
      })
      .where(
        eq(providerProductReferences.sourceCandidateId, input.candidateId),
      );

    await appendAuditEvent(tx, {
      actorId: input.actorId,
      action: AUDIT_ACTION,
      entityType: 'supplier_candidate',
      entityId: input.candidateId,
      payload: {
        schemaVersion: EVIDENCE_SCHEMA_VERSION,
        checksum,
        capturedAt: evidence.capturedAt,
        variantCount: evidence.variants.length,
        imageCount: evidence.imageUrls.length,
        // Deliberately not the evidence body: an audit row is a record that a
        // capture happened, and the snapshot itself is the payload.
      },
    });
  });

  return {
    ok: true,
    checksum,
    capturedAt,
    variantCount: evidence.variants.length,
    imageCount: evidence.imageUrls.length,
  };
}
