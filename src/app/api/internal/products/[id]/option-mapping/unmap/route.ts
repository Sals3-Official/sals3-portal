import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import {
  isProductEditorApiAuthorized,
  resolveProductActor,
} from '@/modules/catalog/products/editor-api-auth';
import { revalidateAfterPublicationChangeFromRouteHandler } from '@/modules/catalog/products/publish-side-effects';
import unmapOptionMapping from '@/modules/catalog/products/unmap-option-mapping';

/**
 * POST /api/internal/products/[id]/option-mapping/unmap - the automation
 * equivalent of `option-mapping-actions.ts`'s `unmapOptionMappingAction`.
 *
 * That action is gated on `product:publish` rather than `product:edit`,
 * because removing a mapping degrades a live PDP to the supplier's own
 * concatenated labels with no publish step in between. This route's secret
 * carries no separate capability tiers - see `category/route.ts`'s doc
 * comment for why a secret-holder is already trusted at that level. The
 * buyer-facing consequence is unchanged and worth restating here too: past
 * orders are untouched (`sals3_order_lines.listing_snapshot` froze the axes
 * at intent creation, ADR-007).
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    expectedProductVersion: z.number().int().positive().optional(),
    reason: z.string().trim().max(500).optional(),
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
    const result = await unmapOptionMapping({
      productId,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
      expectedProductVersion:
        body.expectedProductVersion ?? actor.productVersion,
      reason: body.reason ?? null,
    });

    if (!result.ok) {
      const status = result.reason === 'not_found' ? 404 : 409;
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status, headers: NO_STORE },
      );
    }

    // Removed rows must stop being served the moment they are gone -
    // otherwise the removal would look like it failed while having fully
    // committed.
    revalidateAfterPublicationChangeFromRouteHandler();

    return NextResponse.json(
      {
        ok: true,
        removedAxisCount: result.removedAxisCount,
        removedValueCount: result.removedValueCount,
        unmappedVariantCount: result.unmappedVariantCount,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal option-mapping unmap failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
