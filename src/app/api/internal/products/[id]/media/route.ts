import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import {
  authorizeEditorApiRequest,
  resolveApiActor,
} from '@/modules/catalog/products/editor-api-auth';
import { uploadSellerProductMedia } from '@/modules/catalog/products/upload-seller-media';

/**
 * POST /api/internal/products/[id]/media - the automation equivalent of
 * `media-actions.ts`'s `uploadSellerMediaAction`.
 *
 * Takes `multipart/form-data`, matching the Server Action's own `FormData`
 * shape exactly (a `file` field plus an optional `variantId`) rather than a
 * JSON/base64 body - the domain function reads raw bytes either way, and a
 * multipart body is what every HTTP client already knows how to send for a
 * file upload, with no ~33% base64 inflation against `MAX_UPLOAD_BYTES`.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const fieldsSchema = z.object({
  variantId: z.string().uuid().nullish(),
});

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

  const parsed = fieldsSchema.safeParse({
    variantId: formData.get('variantId'),
  });

  if (!parsed.success) {
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
    const result = await uploadSellerProductMedia({
      productId,
      variantId: parsed.data.variantId ?? null,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
      fileBytes: await file.arrayBuffer(),
    });

    if (!result.ok) {
      const status = result.reason === 'NOT_FOUND' ? 404 : 409;
      return NextResponse.json({ ...result }, { status, headers: NO_STORE });
    }

    // Same reasoning as the Server Action: the Product Catalogue row can
    // show this product's media too.
    revalidateListingViews();

    return NextResponse.json(
      {
        ok: true,
        media: { ...result.media, variantId: parsed.data.variantId ?? null },
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal media upload failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
