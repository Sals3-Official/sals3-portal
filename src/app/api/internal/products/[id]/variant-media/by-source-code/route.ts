import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import revalidateListingViews from '@/app/(portal)/listings/revalidate-listing-views';
import assignVariantMediaBySource from '@/modules/catalog/products/assign-variant-media-by-source';
import {
  authorizeEditorApiRequest,
  resolveApiActor,
} from '@/modules/catalog/products/editor-api-auth';

/**
 * POST /api/internal/products/[id]/variant-media/by-source-code - one call
 * that points a photo at each first-axis value, addressed by the CJ image
 * code in the photo's own stored address.
 *
 * This replaces the last Portal write the automation still performed by
 * driving a browser (the photo picker). The matching and refusal rules live
 * in `assign-variant-media-by-source.ts` - server-side on purpose, per the
 * owner's instruction of 2026-09-02: local scripts may exist, but the
 * functions themselves belong in the API. Each accepted pair is written
 * through the same `assignVariantMedia` domain function the picker's Server
 * Action calls.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 60;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    assignments: z
      .array(
        z.object({
          firstAxisValue: z.string().trim().min(1).max(120),
          /** The UUID inside the CJ image address. */
          sourceCode: z
            .string()
            .trim()
            .regex(
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
            ),
        }),
      )
      .min(1)
      .max(64),
  })
  .strict();

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

  const actor = await resolveApiActor(caller, productId);

  if (actor === null) {
    return NextResponse.json(
      { ok: false, reason: 'not_found' },
      { status: 404, headers: NO_STORE },
    );
  }

  try {
    const result = await assignVariantMediaBySource({
      productId,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
      assignments: body.assignments,
    });

    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : 409;

      return NextResponse.json(
        { ok: false, reason: result.reason, detail: result.detail },
        { status, headers: NO_STORE },
      );
    }

    if (result.assigned > 0) {
      // Same cache reasoning as the single-photo route: the editor reads
      // variant media through the catalogue read-model. No storefront tag -
      // a variant photo is not part of the published feed until the listing
      // is published again.
      revalidateListingViews();
    }

    return NextResponse.json(
      { ok: true, assigned: result.assigned, outcomes: result.outcomes },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal variant-media by-source-code failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
