import captureCandidateEvidence, {
  type CaptureEvidenceResult,
} from '@/modules/catalog/candidates/capture-evidence';
import type { ProductDraftFailureReason } from './contracts';

/**
 * The CJ-evidence-capture step every product-draft creation path takes
 * before `createProductDraftFromCandidate` runs, shared between
 * `product-draft-actions.ts` (the seller-session Server Actions) and
 * `/api/internal/products/draft*` (the internal-API routes) so the two
 * cannot silently drift into two different notions of "captured evidence" -
 * `publish-side-effects.ts`'s recurring lesson this session about a rule
 * that exists in two places instead of one.
 *
 * Extracted rather than duplicated for the same reason: a `'use server'`
 * file may only export async functions, so these could not stay in
 * `product-draft-actions.ts` and still be importable from a route handler.
 */

type DraftCaptureFailure = { ok: false; reason: ProductDraftFailureReason };

export async function createCjEvidenceAdapter() {
  const [
    { default: CjSupplierAdapter },
    { default: CjTokenManager },
    { default: PostgresSupplierSecretStore },
  ] = await Promise.all([
    import('@/modules/suppliers/providers/cj/cj-adapter'),
    import('@/modules/suppliers/providers/cj/cj-auth'),
    import('@/lib/secrets/postgres-supplier-secret-store'),
  ]);
  const secretStore = new PostgresSupplierSecretStore();

  return new CjSupplierAdapter(secretStore, new CjTokenManager(secretStore));
}

function mapCaptureFailure(
  outcome: Extract<CaptureEvidenceResult, { ok: false }>,
): DraftCaptureFailure {
  if (outcome.reason === 'rate_limited') {
    return { ok: false, reason: 'rate_limited' };
  }

  if (outcome.reason === 'not_found') {
    return { ok: false, reason: 'not_found' };
  }

  return { ok: false, reason: outcome.reason };
}

export async function captureEvidenceBeforeDraft(input: {
  candidateId: string;
  sellerAccountId: string;
  actorId: string;
  adapter: Awaited<ReturnType<typeof createCjEvidenceAdapter>>;
}): Promise<DraftCaptureFailure | null> {
  const outcome = await captureCandidateEvidence(
    { adapter: input.adapter },
    {
      candidateId: input.candidateId,
      sellerAccountId: input.sellerAccountId,
      actorId: input.actorId,
    },
  );

  return outcome.ok ? null : mapCaptureFailure(outcome);
}
