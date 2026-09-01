import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import {
  isProductEditorApiAuthorized,
  resolveProductActor,
} from '@/modules/catalog/products/editor-api-auth';
import saveShowSupplierPhoto from '@/modules/catalog/products/save-show-supplier-photo';

/**
 * POST /api/internal/products/[id]/show-supplier-photo - the automation
 * equivalent of `show-supplier-photo-actions.ts`'s
 * `saveShowSupplierPhotoAction`. No storefront cache tag is touched, matching
 * the Server Action: nothing renders this field yet.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    expectedProductVersion: z.number().int().positive().optional(),
    showSupplierPhoto: z.boolean(),
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
    const result = await saveShowSupplierPhoto({
      productId,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
      expectedProductVersion:
        body.expectedProductVersion ?? actor.productVersion,
      showSupplierPhoto: body.showSupplierPhoto,
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
      { ok: true, productVersion: result.productVersion },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal show-supplier-photo write failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
