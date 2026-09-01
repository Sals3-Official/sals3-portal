import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import assignVariantMedia from '@/modules/catalog/products/assign-variant-media';
import {
  isProductEditorApiAuthorized,
  resolveProductActor,
} from '@/modules/catalog/products/editor-api-auth';

/**
 * POST /api/internal/products/[id]/variant-media - the automation
 * equivalent of `variant-media-actions.ts`'s `assignVariantMediaAction`:
 * points one stored photo at one variant, or back to product level when
 * `variantId` is `null`.
 *
 * No `expectedProductVersion` - the Server Action itself takes none: this
 * write touches one nullable column on one media row, creates no revision,
 * and cannot conflict with a concurrent draft save (see that file's doc
 * comment for why a compare-and-set token would cost correctness for no
 * gain here).
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    mediaId: z.string().uuid(),
    variantId: z.string().uuid().nullable(),
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
    const result = await assignVariantMedia({
      productId,
      mediaId: body.mediaId,
      variantId: body.variantId,
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

    // No storefront tag: a variant photo is not part of the published feed
    // until the listing is published again, matching the Server Action.
    revalidateListingViews();

    return NextResponse.json(
      { ok: true, mediaId: result.mediaId, variantId: result.variantId },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal variant-media assignment failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
