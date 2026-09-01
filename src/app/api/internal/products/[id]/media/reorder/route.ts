import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import {
  isProductEditorApiAuthorized,
  resolveProductActor,
} from '@/modules/catalog/products/editor-api-auth';
import reorderProductMedia from '@/modules/catalog/products/reorder-product-media';

/**
 * POST /api/internal/products/[id]/media/reorder - the automation
 * equivalent of `media-actions.ts`'s `reorderProductMediaAction`. Also how
 * the cover photo is chosen (ADR-011 amendment 2026-08-28: the cover is
 * position 0).
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    mediaIds: z.array(z.string().uuid()).min(1).max(64),
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
    const raw: unknown = await request.json();
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

  try {
    const result = await reorderProductMedia({
      productId,
      mediaIds: body.mediaIds,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
    });

    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : 409;
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status, headers: NO_STORE },
      );
    }

    revalidateListingViews();

    return NextResponse.json(
      { ok: true, positioned: result.positioned },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal media reorder failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
