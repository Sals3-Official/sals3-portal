import { NextResponse, type NextRequest } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db/client';
import { uploadDescriptionImage } from '@/modules/catalog/products/description-image-storage';
import {
  authorizeEditorApiRequest,
  resolveApiActor,
} from '@/modules/catalog/products/editor-api-auth';

/**
 * POST /api/internal/products/[id]/description-image - the automation
 * equivalent of `description-image-actions.ts`'s
 * `uploadDescriptionImageAction`: stores an image referenced from inside a
 * description block and hands back its URL.
 *
 * Separate from `/media` on purpose, matching the Server Action: this does
 * not write a `product_media_sources` row, so it is neither a gallery photo
 * nor a cover-photo candidate. Nothing here calls
 * `revalidateListingViews()` either - the URL only takes effect once the
 * description document that references it is saved through
 * `/draft` or `/description`.
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

  const { id: productId } = await params;

  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { ok: false, reason: 'invalid_input' },
      { status: 400, headers: NO_STORE },
    );
  }

  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json(
      { ok: false, reason: 'invalid_input' },
      { status: 400, headers: NO_STORE },
    );
  }

  const actor = await resolveApiActor(caller, productId);
  if (actor === null) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const result = await uploadDescriptionImage({
      productId,
      fileBytes: await file.arrayBuffer(),
    });

    if (!result.ok) {
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: 409, headers: NO_STORE },
      );
    }

    return NextResponse.json(
      {
        ok: true,
        url: result.url,
        widthPixels: result.widthPixels,
        heightPixels: result.heightPixels,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal description-image upload failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
