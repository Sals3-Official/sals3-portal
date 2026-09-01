import { NextResponse, type NextRequest } from 'next/server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import { checkRateLimit } from '@/lib/rate-limit';
import {
  idempotencyKeySchema,
  type ProductDraftFailureReason,
} from '@/modules/catalog/products/contracts';
import {
  captureEvidenceBeforeDraft,
  createCjEvidenceAdapter,
} from '@/modules/catalog/products/create-draft-evidence';
import createProductDraftFromCandidate from '@/modules/catalog/products/create-draft';
import {
  authorizeEditorApiRequest,
  resolveApiCandidateActor,
} from '@/modules/catalog/products/editor-api-auth';

/**
 * POST /api/internal/products/draft/bulk - the automation equivalent of
 * `product-draft-actions.ts`'s `bulkCreateProductDraftsAction`.
 *
 * Every request in the batch must name a candidate owned by the SAME seller
 * account - unlike the Server Action, which gets that tenant once from the
 * cookie session, this route has no single caller-wide identity to resolve
 * from a `productId`. Mixed-tenant batches are refused up front rather than
 * silently split, so a caller cannot probe candidate ownership by watching
 * which entries in a mixed batch succeed.
 *
 * Sequential by design, exactly like the Server Action: one bounded call
 * owns the batch, and each candidate keeps its own idempotency key.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };
const EVIDENCE_CAPTURE_RATE_LIMIT = { capacity: 12, refillIntervalMs: 60_000 };

const bodySchema = z
  .object({
    requests: z
      .array(
        z.object({
          candidateId: z.string().uuid(),
          idempotencyKey: idempotencyKeySchema,
        }),
      )
      .min(1)
      .max(5),
  })
  .strict();

export async function POST(request: NextRequest): Promise<NextResponse> {
  const caller = await authorizeEditorApiRequest(request);

  if (caller === null) {
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

  // Resolve every candidate's owner up front, and refuse a mixed-tenant
  // batch before spending a single CJ point - see this file's doc comment.
  let sellerAccountId: string | null = null;
  let actorId: string | null = null;

  // eslint-disable-next-line no-restricted-syntax -- sequential ownership checks before any CJ spend, matching the write loop below.
  for (const item of body.requests) {
    // eslint-disable-next-line no-await-in-loop
    const actor = await resolveApiCandidateActor(caller, item.candidateId);

    if (actor === null) {
      return NextResponse.json(
        { ok: false, reason: 'not_found', candidateId: item.candidateId },
        { status: 404, headers: NO_STORE },
      );
    }

    if (sellerAccountId === null) {
      sellerAccountId = actor.sellerAccountId;
      actorId = actor.actorId;
    } else if (actor.sellerAccountId !== sellerAccountId) {
      return NextResponse.json(
        { ok: false, reason: 'mixed_tenant_batch' },
        { status: 400, headers: NO_STORE },
      );
    }
  }

  try {
    const evidenceLimit = checkRateLimit(
      `catalog-evidence:bulk-create-draft:${sellerAccountId}`,
      EVIDENCE_CAPTURE_RATE_LIMIT,
    );

    if (!evidenceLimit.allowed) {
      return NextResponse.json(
        { ok: false, reason: 'rate_limited' },
        { status: 429, headers: NO_STORE },
      );
    }

    const adapter = await createCjEvidenceAdapter();
    let created = 0;
    let replayed = 0;
    const failed: Array<{
      candidateId: string;
      reason: ProductDraftFailureReason;
    }> = [];

    // eslint-disable-next-line no-restricted-syntax -- ordered writes keep load bounded, matching the Server Action.
    for (const item of body.requests) {
      // eslint-disable-next-line no-await-in-loop
      const captureFailure = await captureEvidenceBeforeDraft({
        candidateId: item.candidateId,
        sellerAccountId: sellerAccountId as string,
        actorId: actorId as string,
        adapter,
      });

      if (captureFailure !== null) {
        failed.push({
          candidateId: item.candidateId,
          reason: captureFailure.reason,
        });

        if (
          captureFailure.reason === 'rate_limited' ||
          captureFailure.reason === 'supplier_unavailable'
        ) {
          break;
        }

        // eslint-disable-next-line no-continue
        continue;
      }

      // eslint-disable-next-line no-await-in-loop
      const outcome = await createProductDraftFromCandidate({
        candidateId: item.candidateId,
        sellerAccountId: sellerAccountId as string,
        actorId: actorId as string,
        idempotencyKey: item.idempotencyKey,
      });

      if (outcome.ok) {
        if (outcome.result.replayed) replayed += 1;
        else created += 1;
      } else {
        failed.push({ candidateId: item.candidateId, reason: outcome.reason });
      }
    }

    revalidatePath('/products/pipeline');
    revalidateListingViews();

    return NextResponse.json(
      { ok: true, created, replayed, failed },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal bulk create product drafts failed', {
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
