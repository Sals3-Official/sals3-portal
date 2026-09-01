import { NextResponse, type NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import {
  isProductEditorApiAuthorized,
  resolveProductActor,
} from '@/modules/catalog/products/editor-api-auth';
import { revalidateAfterPublicationChangeFromRouteHandler } from '@/modules/catalog/products/publish-side-effects';
import { recoverSupplierLabels } from '@/modules/catalog/products/recover-supplier-labels';

/**
 * POST /api/internal/products/[id]/option-mapping/recover-labels - the
 * automation equivalent of `option-mapping-actions.ts`'s
 * `recoverSupplierLabelsAction`. Fills only `NULL` supplier labels from
 * `supplier_snapshots.evidence` - a recorded label is supplier content and
 * is never overwritten, so calling this twice is safe and the second call
 * reports nothing recovered. No CJ call, no points (ADR-017).
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

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

  const actor = await resolveProductActor(productId);
  if (actor === null) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const result = await recoverSupplierLabels({
      productId,
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

    // A recovered label changes what the editor derives and what a
    // published PDP renders - only worth expiring the cache when something
    // actually changed, matching the Server Action.
    if (result.recoveredCount > 0) {
      revalidateAfterPublicationChangeFromRouteHandler();
    }

    return NextResponse.json(
      {
        ok: true,
        recoveredCount: result.recoveredCount,
        alreadyLabelledCount: result.alreadyLabelledCount,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal supplier-label recovery failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
