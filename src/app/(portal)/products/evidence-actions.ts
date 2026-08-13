'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { PermissionError } from '@/lib/auth/permissions';
import { requirePermission } from '@/lib/auth/session';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import captureCandidateEvidence from '@/modules/catalog/candidates/capture-evidence';

/**
 * The protected boundary for spending CJ points on evidence.
 *
 * Same discipline as `listings/product-draft-actions.ts`: Zod-validate,
 * authorize, rate-limit, then hand a *server-resolved* tenant and actor to the
 * domain module. Nothing that decides authority arrives from the browser —
 * the only resource reference a caller supplies is a candidate id, and its
 * ownership is re-derived server-side through the supplier connection that
 * owns it.
 *
 * ## Why the rate limit is tighter than the other catalogue actions
 *
 * One capture is three CJ requests, spaced by the adapter's own
 * `REQUEST_SPACING_MS`, against an exhaustible daily points budget reserved
 * for checkout and accepted-order protection (ADR-013 §5). A generous limit
 * here is not a convenience, it is a way to drain the budget that keeps real
 * orders working. `MAX_BATCH` bounds one click; the token bucket bounds the
 * clicking.
 *
 * Next.js verifies the request origin for Server Actions, which is the CSRF
 * control for these cookie-backed mutations.
 */

/** Roughly 12 candidates a minute, or 36 CJ requests. */
const RATE_LIMIT = { capacity: 12, refillIntervalMs: 60_000 };

/**
 * One click cannot queue more than this. At ~1 request/second of enforced
 * spacing, 5 candidates already means about 15 seconds of held server time —
 * past that, the work belongs in a job, not an action.
 */
const MAX_BATCH = 5;

const captureEvidenceInputSchema = z.object({
  candidateIds: z.array(z.string().uuid()).min(1).max(MAX_BATCH),
});

export type CaptureEvidenceFailureReason =
  | 'not_found'
  | 'connection_unhealthy'
  | 'supplier_unavailable'
  | 'rate_limited';

export type CaptureEvidenceActionResult =
  | {
      ok: true;
      captured: number;
      failed: Array<{
        candidateId: string;
        reason: CaptureEvidenceFailureReason;
      }>;
    }
  | {
      ok: false;
      reason:
        | 'invalid_input'
        | 'denied'
        | 'rate_limited'
        | 'not_configured'
        | 'failed';
    };

export async function captureCandidateEvidenceAction(
  input: unknown,
): Promise<CaptureEvidenceActionResult> {
  const parsed = captureEvidenceInputSchema.safeParse(input);

  if (!parsed.success) return { ok: false, reason: 'invalid_input' };

  if (!isDatabaseConfigured()) {
    return { ok: false, reason: 'not_configured' };
  }

  let session;

  try {
    session = await requirePermission('product:import');
  } catch (error) {
    if (error instanceof PermissionError)
      return { ok: false, reason: 'denied' };
    throw error;
  }

  // ADR-006: sourcing from a supplier is a Dropshipper capability.
  if (session.sellerBusinessModel !== 'DROPSHIPPER') {
    return { ok: false, reason: 'denied' };
  }

  // Checked BEFORE the supplier call, so a throttled click spends no points.
  const limit = checkRateLimit(
    `catalog-evidence:capture:${session.sellerId}`,
    RATE_LIMIT,
  );

  if (!limit.allowed) return { ok: false, reason: 'rate_limited' };

  try {
    // Imported here, not at module scope, and only after authorization passed.
    // The secret store carries a `server-only` guard, and this module is
    // referenced by a client component — a static import would put that guard
    // in the client's module graph, where it throws. Loading it inside the
    // authorized branch also means an unauthorized call never touches the
    // credential decryption path at all.
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
    const adapter = new CjSupplierAdapter(
      secretStore,
      new CjTokenManager(secretStore),
    );

    let captured = 0;
    const failed: Array<{
      candidateId: string;
      reason: CaptureEvidenceFailureReason;
    }> = [];

    // Sequential by design: CJ enforces per-second spacing, so issuing these
    // concurrently would earn a rate-limit response rather than finish sooner.
    // eslint-disable-next-line no-restricted-syntax -- ordered writes keep supplier load bounded.
    for (const candidateId of parsed.data.candidateIds) {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await captureCandidateEvidence(
        { adapter },
        {
          candidateId,
          sellerAccountId: session.sellerId,
          actorId: session.userId,
        },
      );

      if (outcome.ok) captured += 1;
      else failed.push({ candidateId, reason: outcome.reason });

      // A supplier that is rate-limiting or unreachable will not recover
      // within one batch; continuing would spend the remaining attempts to
      // learn the same thing.
      if (
        !outcome.ok &&
        (outcome.reason === 'rate_limited' ||
          outcome.reason === 'supplier_unavailable')
      ) {
        break;
      }
    }

    revalidatePath('/products/pipeline');
    revalidatePath('/listings');

    return { ok: true, captured, failed };
  } catch (error) {
    // Generic outward failure; the detail stays in the server log.
    // eslint-disable-next-line no-console
    console.error('[portal] capture candidate evidence failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return { ok: false, reason: 'failed' };
  }
}
