import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import {
  isProductEditorApiAuthorized,
  resolveProductActor,
} from '@/modules/catalog/products/editor-api-auth';
import { revalidateAfterPublicationChangeFromRouteHandler } from '@/modules/catalog/products/publish-side-effects';
import restoreOptionMapping from '@/modules/catalog/products/restore-option-mapping';

/**
 * POST /api/internal/products/[id]/option-mapping/restore - the automation
 * equivalent of `option-mapping-actions.ts`'s `restoreOptionMappingAction`:
 * puts back the Variant Matrix a product used to have, read from the last
 * `options_unmapped` / `options_remapped` audit event. Refused rather than
 * overwritten when a mapping already exists, so the worst outcome is a
 * named matrix where there was none.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    expectedProductVersion: z.number().int().positive().optional(),
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

  try {
    const result = await restoreOptionMapping({
      productId,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
      expectedProductVersion:
        body.expectedProductVersion ?? actor.productVersion,
    });

    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : 409;
      return NextResponse.json(
        { ok: false, reason: result.reason, detail: result.detail },
        { status, headers: NO_STORE },
      );
    }

    revalidateAfterPublicationChangeFromRouteHandler();

    return NextResponse.json(
      {
        ok: true,
        axisCount: result.axisCount,
        mappedVariantCount: result.mappedVariantCount,
        restoredFromEventId: result.restoredFromEventId,
        restoredFromAction: result.restoredFromAction,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal option-mapping restore failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
