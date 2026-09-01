import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import discardProductDraft from '@/modules/catalog/products/discard-draft';
import {
  isProductEditorApiAuthorized,
  resolveProductActor,
  resolveProductRevision,
} from '@/modules/catalog/products/editor-api-auth';

/**
 * POST /api/internal/products/[id]/draft/discard - the automation
 * equivalent of `product-draft-actions.ts`'s `discardProductDraftAction`:
 * abandons the open draft a published product was forked into, restoring
 * `current_revision_id` to the published revision.
 *
 * `revisionId`/`expectedRevisionVersion` optional and auto-resolved via
 * `resolveProductRevision`, same as the save route beside it.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    revisionId: z.string().uuid().optional(),
    expectedRevisionVersion: z.number().int().positive().optional(),
  })
  .strict();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
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

  const { id: productId } = await params;

  let body: z.infer<typeof bodySchema>;

  try {
    const raw: unknown = await request.json().catch(() => ({}));
    body = bodySchema.parse(raw);
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_input' },
      { status: 400, headers: NO_STORE },
    );
  }

  const actor = await resolveProductActor(productId);
  if (actor === null) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404, headers: NO_STORE },
    );
  }

  let { revisionId, expectedRevisionVersion } = body;

  if (revisionId === undefined || expectedRevisionVersion === undefined) {
    const revision = await resolveProductRevision(productId);
    if (revision === null) {
      return NextResponse.json(
        { ok: false, reason: 'not_found' },
        { status: 404, headers: NO_STORE },
      );
    }
    revisionId = revisionId ?? revision.revisionId;
    expectedRevisionVersion =
      expectedRevisionVersion ?? revision.revisionVersion;
  }

  try {
    const outcome = await discardProductDraft({
      request: { productId, revisionId, expectedRevisionVersion },
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
    });

    if (!outcome.ok) {
      const status = outcome.reason === 'not_found' ? 404 : 409;
      return NextResponse.json(
        { ok: false, reason: outcome.reason },
        { status, headers: NO_STORE },
      );
    }

    // The editor lives at `/listings/new?productId=…` and the description
    // studio at `/listings/[productId]/description`; both must re-read, or
    // the discard commits and the screen keeps showing the abandoned copy -
    // matching the Server Action's own comment.
    revalidateListingViews();

    return NextResponse.json(
      {
        ok: true,
        restoredRevisionId: outcome.restoredRevisionId,
        restoredRevisionVersion: outcome.restoredRevisionVersion,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal discard product draft failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
