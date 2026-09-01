import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { isDatabaseConfigured } from '@/lib/db/client';
import { decideProductSals3Category } from '@/modules/catalog/products/decide-category';
import {
  authorizeEditorApiRequest,
  resolveApiActor,
} from '@/modules/catalog/products/editor-api-auth';
import { revalidateAfterPublicationChangeFromRouteHandler } from '@/modules/catalog/products/publish-side-effects';

/**
 * POST /api/internal/products/[id]/category - the automation equivalent of
 * `category-mapping-actions.ts`'s `decideCategoryMappingAction`.
 *
 * `authorizeCategoryGovernance` is not re-derived here: that check gates on
 * a `PortalRole`, which a caller with no session never carries, and its own
 * doc comment says it is granted to "every role that already holds
 * `product:edit`" - the same precondition this route's secret-based trust
 * already implies (a secret-holder is trusted with full editorial
 * authority over the product's own steward account, at least
 * `seller_manager`-equivalent). Not a narrower check bypassed - the same
 * one, satisfied a different way.
 *
 * **Replicates the pricing side effect, on purpose.** The Server Action
 * best-effort re-prices the draft's offers after a successful category
 * decision (`priceDraftOffers`) - its own comment records a real incident:
 * a sourced product priced `UNMAPPED` never got priced again once a
 * category landed, so it sat at `PRICING_UNRESOLVED` and publication was
 * blocked for a reason already fixed elsewhere. Skipping this call here
 * would reintroduce exactly that bug through the one path that bypasses
 * the Server Action.
 */
export const dynamic = 'force-dynamic';
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';
export const maxDuration = 30;

const NO_STORE = { 'Cache-Control': 'private, no-store' };

const bodySchema = z
  .object({
    expectedProductVersion: z.number().int().positive().optional(),
    sals3CategoryCode: z.string().trim().min(1).max(64),
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
    const result = await decideProductSals3Category({
      productId,
      sellerAccountId: actor.sellerAccountId,
      actorId: actor.actorId,
      expectedProductVersion:
        body.expectedProductVersion ?? actor.productVersion,
      sals3CategoryCode: body.sals3CategoryCode,
    });

    if (!result.ok) {
      const status = result.reason === 'NOT_FOUND' ? 404 : 409;
      return NextResponse.json(
        {
          ok: false,
          reason: result.reason,
          detail: 'detail' in result ? result.detail : undefined,
        },
        { status, headers: NO_STORE },
      );
    }

    // Best-effort, never fatal - see the doc comment above.
    try {
      const { default: priceDraftOffers } =
        await import('@/modules/catalog/products/price-draft-offers');
      const { default: getDb } = await import('@/lib/db/client');

      await priceDraftOffers(getDb(), {
        sellerAccountId: actor.sellerAccountId,
        productId,
        actorId: actor.actorId,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[portal] pricing a draft after a category edit failed', {
        productId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }

    revalidateAfterPublicationChangeFromRouteHandler();

    return NextResponse.json(
      {
        ok: true,
        categoryCode: result.categoryCode,
        categoryPath: result.categoryPath,
        productVersion: result.productVersion,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[portal] internal category write failed', {
      productId,
      error: error instanceof Error ? error.message : 'unknown',
    });

    return NextResponse.json(
      { ok: false, reason: 'write_failed' },
      { status: 500, headers: NO_STORE },
    );
  }
}
