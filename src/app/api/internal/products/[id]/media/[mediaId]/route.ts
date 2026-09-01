import { NextResponse, type NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import {
  isProductEditorApiAuthorized,
  resolveProductActor,
} from '@/modules/catalog/products/editor-api-auth';
import { deleteSellerProductMedia } from '@/modules/catalog/products/delete-seller-media';

/**
 * DELETE /api/internal/products/[id]/media/[mediaId] - the automation
 * equivalent of `media-actions.ts`'s `deleteSellerMediaAction`.
 *
 * `deleteSellerProductMedia` only ever deletes a `SELLER_UPLOAD` row - see
 * that module's own doc comment - so a `mediaId` naming a
 * `SUPPLIER_ORIGINAL` row deletes nothing and reports the same `NOT_FOUND`
 * a genuinely unknown id would, exactly as the Server Action behaves.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> },
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

  const { id: productId, mediaId } = await params;

  const actor = await resolveProductActor(productId);
  if (actor === null) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const result = await deleteSellerProductMedia({
      productId,
      mediaId,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: 404, headers: NO_STORE },
      );
    }

    revalidateListingViews();

    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal media delete failed', {
      productId,
      mediaId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
