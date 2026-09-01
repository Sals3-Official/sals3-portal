import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';
import { idempotencyKeySchema } from '@/modules/catalog/products/contracts';
import {
  captureEvidenceBeforeDraft,
  createCjEvidenceAdapter,
} from '@/modules/catalog/products/create-draft-evidence';
import createProductDraftFromCandidate from '@/modules/catalog/products/create-draft';
import {
  isProductEditorApiAuthorized,
  resolveCandidateActor,
} from '@/modules/catalog/products/editor-api-auth';

/**
 * POST /api/internal/products/draft - the automation equivalent of
 * `product-draft-actions.ts`'s `createProductDraftAction`: creates (or
 * replays) the Sals3 product draft for a sourcing candidate this seller
 * owns.
 *
 * The one route in this family with no `productId` at all - there is no
 * product yet - so identity is resolved from the candidate instead, via
 * `resolveCandidateActor` (see its doc comment for the ownership chain).
 * Makes a real CJ call and spends real CJ points (ADR-013 §5) exactly like
 * the Server Action, through the identical `captureEvidenceBeforeDraft` step
 * - not a lighter-weight reimplementation.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };
/** Same point-spend ceiling as the Server Action's explicit evidence-capture bucket. */
const EVIDENCE_CAPTURE_RATE_LIMIT = { capacity: 12, refillIntervalMs: 60_000 };

const bodySchema = z
  .object({
    candidateId: z.string().uuid(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isProductEditorApiAuthorized(request.headers.get('authorization'))) {
    return NextResponse.json(
      { ok: false, reason: 'unauthorized' },
      { status: 401, headers: NO_STORE },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, reason: 'not_configured' },
      { status: 503, headers: NO_STORE },
    );
  }

  let body: z.infer<typeof bodySchema>;

  try {
    const raw: unknown = await request.json();
    body = bodySchema.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_input' },
      { status: 400, headers: NO_STORE },
    );
  }

  const actor = await resolveCandidateActor(body.candidateId);
  if (actor === null) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const evidenceLimit = checkRateLimit(
      `catalog-evidence:create-draft:${actor.sellerAccountId}`,
      EVIDENCE_CAPTURE_RATE_LIMIT,
    );

    if (!evidenceLimit.allowed) {
      return NextResponse.json(
        { ok: false, reason: 'rate_limited' },
        { status: 429, headers: NO_STORE },
      );
    }

    const adapter = await createCjEvidenceAdapter();
    const captureFailure = await captureEvidenceBeforeDraft({
      candidateId: body.candidateId,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
      adapter,
    });

    if (captureFailure !== null) {
      const status = captureFailure.reason === 'not_found' ? 404 : 409;
      return NextResponse.json(captureFailure, { status, headers: NO_STORE });
    }

    const outcome = await createProductDraftFromCandidate({
      candidateId: body.candidateId,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
      idempotencyKey: body.idempotencyKey,
    });

    if (!outcome.ok) {
      const status = outcome.reason === 'not_found' ? 404 : 409;
      return NextResponse.json(
        { ok: false, reason: outcome.reason },
        { status, headers: NO_STORE },
      );
    }

    // No `revalidateListingViews()` here - `createProductDraftAction` itself
    // does not call it either. These actions have no UI wiring yet (see this
    // file's own doc comment), so nothing reads a cache this write would need
    // to invalidate.
    return NextResponse.json(
      { ok: true, result: outcome.result },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal create product draft failed', {
      candidateId: body.candidateId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
